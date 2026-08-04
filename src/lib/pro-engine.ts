import {
  Stem,
  StemProcessing,
  MasterProcessing,
  MeterData,
  EQBand,
  CompressorSettings,
  SaturationSettings,
  StereoWidthSettings,
  LimiterSettings,
  BusId,
  SendFxId,
  AudioClip,
  BusState,
  defaultBusIdForStem,
} from '@/types/audio';
import { ALL_BUS_IDS } from './defaults';

export interface ProMeterData extends MeterData {
  momentaryLUFS: number;
  shortTermLUFS: number;
  integratedLUFS: number;
  truePeakL: number;
  truePeakR: number;
  peakHoldL: number;
  peakHoldR: number;
  phaseCorrelation: number;
  compressorGR: number;
  limiterGR: number;
  bandLevels: number[];
  bandGR: number[];
}

export type ExportBitDepth = 16 | 24 | 32;
export type DitherType = 'none' | 'tpdf' | 'noise-shaped';
export type ExportFormat = 'wav' | 'mp3' | 'flac';
export type SaturationMode = 'tape' | 'tube' | 'transformer' | 'hardclip' | 'softclip';

const SAT_MODE_MAP: Record<SaturationMode, number> = {
  tape: 0,
  tube: 1,
  transformer: 2,
  hardclip: 3,
  softclip: 4,
};

export class ProStemChannel {
  private context: AudioContext;
  private sourceNode: AudioBufferSourceNode | null = null;
  private eqNodes: BiquadFilterNode[] = [];
  private compressorNode: AudioWorkletNode | null = null;
  private saturationNode: AudioWorkletNode | null = null;
  private sidechainCompNode: AudioWorkletNode | null = null;
  private transientNode: AudioWorkletNode | null = null;
  private gateNode: AudioWorkletNode | null = null;
  private gainNode: GainNode;
  private panNode: StereoPannerNode;
  private analyserNode: AnalyserNode;
  private muteGainNode: GainNode;
  public output: GainNode;
  public preSendTap: GainNode; // tap point for sidechain sends
  private buffer: AudioBuffer | null = null;
  private workletsLoaded = false;
  public compressorGR = 0;
  public sidechainGR = 0;
  private hasSidechainSource = false;

  // Fallback nodes when worklets aren't loaded
  private fallbackCompressor: DynamicsCompressorNode;
  private fallbackSaturation: WaveShaperNode;

  constructor(context: AudioContext) {
    this.context = context;
    this.gainNode = context.createGain();
    this.panNode = context.createStereoPanner();
    this.analyserNode = context.createAnalyser();
    this.analyserNode.fftSize = 4096;
    this.analyserNode.smoothingTimeConstant = 0.85;
    this.muteGainNode = context.createGain();
    this.output = context.createGain();
    this.preSendTap = context.createGain();

    this.fallbackCompressor = context.createDynamicsCompressor();
    this.fallbackSaturation = context.createWaveShaper();
    this.fallbackSaturation.oversample = '4x';

    this.initEQ();
  }

  private initEQ() {
    // 6-band parametric EQ
    const bands: { frequency: number; type: BiquadFilterType }[] = [
      { frequency: 60, type: 'highpass' },
      { frequency: 200, type: 'lowshelf' },
      { frequency: 800, type: 'peaking' },
      { frequency: 2500, type: 'peaking' },
      { frequency: 6000, type: 'peaking' },
      { frequency: 12000, type: 'highshelf' },
    ];
    this.eqNodes = bands.map((band) => {
      const filter = this.context.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = band.frequency;
      filter.gain.value = 0;
      filter.Q.value = 1;
      return filter;
    });
  }

  async initWorklets() {
    try {
      this.compressorNode = new AudioWorkletNode(this.context, 'compressor-processor');
      this.saturationNode = new AudioWorkletNode(this.context, 'saturation-processor');
      this.sidechainCompNode = new AudioWorkletNode(this.context, 'sidechain-compressor-processor', {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.transientNode = new AudioWorkletNode(this.context, 'transient-designer-processor');
      this.gateNode = new AudioWorkletNode(this.context, 'gate-expander-processor');

      this.compressorNode.port.onmessage = (e) => {
        if (e.data.type === 'gainReduction') {
          this.compressorGR = e.data.value;
        }
      };
      this.sidechainCompNode.port.onmessage = (e) => {
        if (e.data.type === 'gainReduction') {
          this.sidechainGR = e.data.value;
        }
      };

      this.workletsLoaded = true;
    } catch {
      this.workletsLoaded = false;
    }
    this.connectChain();
  }

  connectWithFallback() {
    this.workletsLoaded = false;
    this.connectChain();
  }

  private connectChain() {
    // Disconnect everything first
    this.eqNodes.forEach((n) => { try { n.disconnect(); } catch {} });
    try { this.gainNode.disconnect(); } catch {}
    try { this.panNode.disconnect(); } catch {}
    try { this.muteGainNode.disconnect(); } catch {}
    try { this.analyserNode.disconnect(); } catch {}

    // Chain: EQ → Compressor → Saturation → Gain → Pan → Mute → Analyser → Output
    for (let i = 1; i < this.eqNodes.length; i++) {
      this.eqNodes[i - 1].connect(this.eqNodes[i]);
    }
    const lastEQ = this.eqNodes[this.eqNodes.length - 1];

    if (this.workletsLoaded && this.compressorNode && this.saturationNode && this.gateNode && this.transientNode) {
      // Chain: EQ → Gate → Compressor → Saturation → Transient Designer → Gain
      lastEQ.connect(this.gateNode);
      this.gateNode.connect(this.compressorNode);
      this.compressorNode.connect(this.saturationNode);
      this.saturationNode.connect(this.transientNode);
      this.transientNode.connect(this.gainNode);
    } else {
      lastEQ.connect(this.fallbackCompressor);
      this.fallbackCompressor.connect(this.fallbackSaturation);
      this.fallbackSaturation.connect(this.gainNode);
    }

    this.gainNode.connect(this.panNode);
    this.panNode.connect(this.muteGainNode);

    // Insert sidechain compressor if active
    if (this.hasSidechainSource && this.workletsLoaded && this.sidechainCompNode) {
      this.muteGainNode.connect(this.sidechainCompNode, 0, 0);
      // Input 1 (sidechain key) is connected externally via connectSidechainFrom()
      this.sidechainCompNode.connect(this.analyserNode);
    } else {
      this.muteGainNode.connect(this.analyserNode);
    }

    this.analyserNode.connect(this.output);

    // Pre-send tap: always tapped from after EQ, before compressor, for sidechain sends
    // We tap from the pan output so the send includes the panned signal
    this.panNode.connect(this.preSendTap);
  }

  /** Connect another stem's output as sidechain key input */
  connectSidechainFrom(sourceChannel: ProStemChannel) {
    if (!this.workletsLoaded || !this.sidechainCompNode) return;
    this.hasSidechainSource = true;
    // Reconnect chain to insert sidechain compressor
    this.connectChain();
    // Connect source's pre-send tap to our sidechain input 1
    sourceChannel.preSendTap.connect(this.sidechainCompNode, 0, 1);
  }

  /** Disconnect sidechain routing */
  disconnectSidechain() {
    if (!this.sidechainCompNode) return;
    try { this.sidechainCompNode.disconnect(); } catch {}
    this.hasSidechainSource = false;
    this.connectChain();
  }

  /** Update sidechain compressor parameters */
  updateSidechainParams(params: {
    threshold?: number;
    ratio?: number;
    attack?: number;
    release?: number;
    range?: number;
    mix?: number;
    filterFreq?: number;
    filterType?: number;
    filterQ?: number;
  }) {
    if (!this.sidechainCompNode) return;
    const p = this.sidechainCompNode.parameters;
    if (params.threshold !== undefined) this.setWorkletParam(p, 'threshold', params.threshold);
    if (params.ratio !== undefined) this.setWorkletParam(p, 'ratio', params.ratio);
    if (params.attack !== undefined) this.setWorkletParam(p, 'attack', params.attack);
    if (params.release !== undefined) this.setWorkletParam(p, 'release', params.release);
    if (params.range !== undefined) this.setWorkletParam(p, 'range', params.range);
    if (params.mix !== undefined) this.setWorkletParam(p, 'mix', params.mix);
    if (params.filterFreq !== undefined) this.setWorkletParam(p, 'scFilterFreq', params.filterFreq);
    if (params.filterType !== undefined) this.setWorkletParam(p, 'scFilterType', params.filterType);
    if (params.filterQ !== undefined) this.setWorkletParam(p, 'scFilterQ', params.filterQ);
  }

  /** Update transient designer parameters */
  updateTransientParams(params: {
    attack?: number;
    sustain?: number;
    speed?: number;
    sensitivity?: number;
    mix?: number;
  }) {
    if (!this.transientNode) return;
    const p = this.transientNode.parameters;
    if (params.attack !== undefined) this.setWorkletParam(p, 'attack', params.attack);
    if (params.sustain !== undefined) this.setWorkletParam(p, 'sustain', params.sustain);
    if (params.speed !== undefined) this.setWorkletParam(p, 'speed', params.speed);
    if (params.sensitivity !== undefined) this.setWorkletParam(p, 'sensitivity', params.sensitivity);
    if (params.mix !== undefined) this.setWorkletParam(p, 'mix', params.mix);
  }

  /** Update gate/expander parameters */
  updateGateParams(params: {
    threshold?: number;
    ratio?: number;
    attack?: number;
    hold?: number;
    release?: number;
    range?: number;
    hysteresis?: number;
  }) {
    if (!this.gateNode) return;
    const p = this.gateNode.parameters;
    if (params.threshold !== undefined) this.setWorkletParam(p, 'threshold', params.threshold);
    if (params.ratio !== undefined) this.setWorkletParam(p, 'ratio', params.ratio);
    if (params.attack !== undefined) this.setWorkletParam(p, 'attack', params.attack);
    if (params.hold !== undefined) this.setWorkletParam(p, 'hold', params.hold);
    if (params.release !== undefined) this.setWorkletParam(p, 'release', params.release);
    if (params.range !== undefined) this.setWorkletParam(p, 'range', params.range);
    if (params.hysteresis !== undefined) this.setWorkletParam(p, 'hysteresis', params.hysteresis);
  }

  /** Automation-friendly setters */
  setGain(db: number) {
    this.gainNode.gain.setTargetAtTime(Math.pow(10, db / 20), this.context.currentTime, 0.01);
  }

  setPan(value: number) {
    this.panNode.pan.setTargetAtTime(Math.max(-1, Math.min(1, value)), this.context.currentTime, 0.01);
  }

  setCompressorThreshold(db: number) {
    if (this.compressorNode) {
      this.setWorkletParam(this.compressorNode.parameters, 'threshold', db);
    } else {
      this.fallbackCompressor.threshold.setTargetAtTime(db, this.context.currentTime, 0.01);
    }
  }

  setCompressorRatio(ratio: number) {
    if (this.compressorNode) {
      this.setWorkletParam(this.compressorNode.parameters, 'ratio', ratio);
    } else {
      this.fallbackCompressor.ratio.setTargetAtTime(ratio, this.context.currentTime, 0.01);
    }
  }

  setBuffer(buffer: AudioBuffer) {
    this.buffer = buffer;
  }

  play(offset = 0) {
    this.stop();
    if (!this.buffer) return;
    this.sourceNode = this.context.createBufferSource();
    this.sourceNode.buffer = this.buffer;
    this.sourceNode.connect(this.eqNodes[0]);
    this.sourceNode.start(0, offset);
  }

  stop() {
    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch {}
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
  }

  updateProcessing(processing: StemProcessing, bypass: boolean) {
    if (bypass || processing.bypass) {
      this.eqNodes.forEach((n) => {
        if (n.type === 'highpass' || n.type === 'lowpass') return;
        n.gain.value = 0;
      });
      if (this.workletsLoaded && this.compressorNode) {
        const tp = this.compressorNode.parameters.get('ratio');
        if (tp) tp.value = 1;
      } else {
        this.fallbackCompressor.threshold.value = 0;
        this.fallbackCompressor.ratio.value = 1;
      }
      this.gainNode.gain.value = 1;
      this.panNode.pan.value = 0;
      this.muteGainNode.gain.value = processing.mute ? 0 : 1;
      return;
    }

    // EQ - map first 3 bands from processing.eq to our 6 bands (use center 3)
    processing.eq.forEach((band, i) => {
      // Map to bands 1-3 (skip highpass at index 0, use lowshelf/peaking/highshelf)
      const targetIdx = i + 1;
      if (this.eqNodes[targetIdx]) {
        this.eqNodes[targetIdx].type = band.type;
        this.eqNodes[targetIdx].frequency.value = band.frequency;
        this.eqNodes[targetIdx].gain.value = band.gain;
        this.eqNodes[targetIdx].Q.value = band.Q;
      }
    });

    // Compressor
    if (this.workletsLoaded && this.compressorNode) {
      const params = this.compressorNode.parameters;
      this.setWorkletParam(params, 'threshold', processing.compressor.threshold);
      this.setWorkletParam(params, 'ratio', processing.compressor.ratio);
      this.setWorkletParam(params, 'attack', processing.compressor.attack);
      this.setWorkletParam(params, 'release', processing.compressor.release);
      this.setWorkletParam(params, 'knee', processing.compressor.knee);
      this.setWorkletParam(params, 'makeupGain', processing.compressor.makeupGain);
    } else {
      this.fallbackCompressor.threshold.value = processing.compressor.threshold;
      this.fallbackCompressor.ratio.value = processing.compressor.ratio;
      this.fallbackCompressor.attack.value = processing.compressor.attack;
      this.fallbackCompressor.release.value = processing.compressor.release;
      this.fallbackCompressor.knee.value = processing.compressor.knee;
    }

    // Saturation
    if (this.workletsLoaded && this.saturationNode) {
      const params = this.saturationNode.parameters;
      this.setWorkletParam(params, 'drive', processing.saturation.drive);
      this.setWorkletParam(params, 'mix', processing.saturation.mix);
    } else {
      this.applyFallbackSaturation(processing.saturation);
    }

    this.gainNode.gain.setTargetAtTime(Math.pow(10, processing.gain / 20), this.context.currentTime, 0.005);
    this.panNode.pan.setTargetAtTime(processing.pan, this.context.currentTime, 0.005);
    this.muteGainNode.gain.setTargetAtTime(processing.mute ? 0 : 1, this.context.currentTime, 0.005);
  }

  /** Smooth param changes (5 ms time constant) to avoid zipper noise. */
  private setWorkletParam(params: AudioParamMap, name: string, value: number) {
    const param = params.get(name);
    if (!param) return;
    try {
      param.setTargetAtTime(value, this.context.currentTime, 0.005);
    } catch {
      param.value = value;
    }
  }

  private applyFallbackSaturation(settings: SaturationSettings) {
    if (settings.drive <= 0) {
      this.fallbackSaturation.curve = null;
      return;
    }
    const samples = 44100;
    const curve = new Float32Array(samples);
    const drive = settings.drive * 10;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      const wet = Math.tanh(x * drive);
      curve[i] = x * (1 - settings.mix) + wet * settings.mix;
    }
    this.fallbackSaturation.curve = curve;
  }

  getAnalyserData(): Float32Array {
    const data = new Float32Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getFloatFrequencyData(data);
    return data;
  }

  getTimeDomainData(): Float32Array {
    const data = new Float32Array(this.analyserNode.fftSize);
    this.analyserNode.getFloatTimeDomainData(data);
    return data;
  }

  destroy() {
    this.stop();
    this.eqNodes.forEach((n) => { try { n.disconnect(); } catch {} });
    try { this.compressorNode?.disconnect(); } catch {}
    try { this.saturationNode?.disconnect(); } catch {}
    try { this.sidechainCompNode?.disconnect(); } catch {}
    try { this.transientNode?.disconnect(); } catch {}
    try { this.gateNode?.disconnect(); } catch {}
    try { this.fallbackCompressor.disconnect(); } catch {}
    try { this.fallbackSaturation.disconnect(); } catch {}
    try { this.gainNode.disconnect(); } catch {}
    try { this.panNode.disconnect(); } catch {}
    try { this.analyserNode.disconnect(); } catch {}
    try { this.muteGainNode.disconnect(); } catch {}
    try { this.output.disconnect(); } catch {}
    try { this.preSendTap.disconnect(); } catch {}
  }
}

/** Group bus — gain/mute between stems and master. */
export class ProBusChannel {
  public input: GainNode;
  public output: GainNode;
  private gainNode: GainNode;
  private muteGain: GainNode;

  constructor(context: AudioContext) {
    this.input = context.createGain();
    this.gainNode = context.createGain();
    this.muteGain = context.createGain();
    this.output = context.createGain();
    this.input.connect(this.gainNode);
    this.gainNode.connect(this.muteGain);
    this.muteGain.connect(this.output);
  }

  setGainDb(db: number) {
    this.gainNode.gain.value = Math.pow(10, db / 20);
  }

  setMute(mute: boolean) {
    this.muteGain.gain.value = mute ? 0 : 1;
  }

  destroy() {
    try { this.input.disconnect(); } catch {}
    try { this.gainNode.disconnect(); } catch {}
    try { this.muteGain.disconnect(); } catch {}
    try { this.output.disconnect(); } catch {}
  }
}

/** Simple shared FX return using Convolver-free delay/reverb nodes. */
export class ProFxReturn {
  public input: GainNode;
  public output: GainNode;
  private wet: GainNode;

  constructor(context: AudioContext, kind: 'reverb' | 'delay') {
    this.input = context.createGain();
    this.wet = context.createGain();
    this.wet.gain.value = 0.35;
    this.output = context.createGain();

    if (kind === 'delay') {
      const delay = context.createDelay(1.0);
      delay.delayTime.value = 0.22;
      const fb = context.createGain();
      fb.gain.value = 0.25;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 4500;
      this.input.connect(delay);
      delay.connect(filter);
      filter.connect(fb);
      fb.connect(delay);
      filter.connect(this.wet);
    } else {
      // Cheap multi-tap "room"
      const delays = [0.029, 0.037, 0.053, 0.079].map((t) => {
        const d = context.createDelay(0.2);
        d.delayTime.value = t;
        return d;
      });
      const sum = context.createGain();
      sum.gain.value = 0.3;
      const lp = context.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6000;
      for (const d of delays) {
        this.input.connect(d);
        d.connect(sum);
      }
      sum.connect(lp);
      lp.connect(this.wet);
    }
    this.wet.connect(this.output);
  }

  setWet(level: number) {
    this.wet.gain.value = Math.max(0, Math.min(1, level));
  }

  destroy() {
    try { this.input.disconnect(); } catch {}
    try { this.wet.disconnect(); } catch {}
    try { this.output.disconnect(); } catch {}
  }
}

export class ProMasterChannel {
  private context: AudioContext;
  private eqNodes: BiquadFilterNode[] = [];
  private compressorNode: AudioWorkletNode | null = null;
  private limiterNode: AudioWorkletNode | null = null;
  private saturationNode: AudioWorkletNode | null = null;
  private multibandNode: AudioWorkletNode | null = null;
  private midSideNode: AudioWorkletNode | null = null;
  private stereoImagerNode: AudioWorkletNode | null = null;
  private meteringNode: AudioWorkletNode | null = null;
  private gainNode: GainNode;
  private analyserL: AnalyserNode;
  private analyserR: AnalyserNode;
  private splitter: ChannelSplitterNode;
  public input: GainNode;
  public output: GainNode;
  private workletsLoaded = false;

  // Fallbacks
  private fallbackCompressor: DynamicsCompressorNode;
  private fallbackLimiter: DynamicsCompressorNode;
  private fallbackSaturation: WaveShaperNode;

  // Metering data from worklet
  public proMeter: ProMeterData = {
    peakL: -Infinity, peakR: -Infinity,
    rmsL: -Infinity, rmsR: -Infinity,
    lufs: -Infinity, clipCount: 0,
    momentaryLUFS: -Infinity, shortTermLUFS: -Infinity, integratedLUFS: -Infinity,
    truePeakL: -Infinity, truePeakR: -Infinity,
    peakHoldL: -Infinity, peakHoldR: -Infinity,
    phaseCorrelation: 1, compressorGR: 0, limiterGR: 0,
    bandLevels: [0, 0, 0, 0], bandGR: [0, 0, 0, 0],
  };

  constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();
    this.gainNode = context.createGain();

    this.fallbackCompressor = context.createDynamicsCompressor();
    this.fallbackLimiter = context.createDynamicsCompressor();
    this.fallbackLimiter.ratio.value = 20;
    this.fallbackLimiter.knee.value = 0;
    this.fallbackLimiter.attack.value = 0.001;
    this.fallbackSaturation = context.createWaveShaper();
    this.fallbackSaturation.oversample = '4x';

    this.analyserL = context.createAnalyser();
    this.analyserL.fftSize = 4096;
    this.analyserR = context.createAnalyser();
    this.analyserR.fftSize = 4096;
    this.splitter = context.createChannelSplitter(2);

    this.initEQ();
  }

  private initEQ() {
    const bands: { frequency: number; type: BiquadFilterType }[] = [
      { frequency: 30, type: 'highpass' },
      { frequency: 80, type: 'lowshelf' },
      { frequency: 400, type: 'peaking' },
      { frequency: 1000, type: 'peaking' },
      { frequency: 4000, type: 'peaking' },
      { frequency: 8000, type: 'highshelf' },
    ];
    this.eqNodes = bands.map((band) => {
      const filter = this.context.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = band.frequency;
      filter.gain.value = 0;
      filter.Q.value = 0.707;
      return filter;
    });
  }

  async initWorklets() {
    try {
      this.compressorNode = new AudioWorkletNode(this.context, 'compressor-processor');
      this.limiterNode = new AudioWorkletNode(this.context, 'limiter-processor');
      this.saturationNode = new AudioWorkletNode(this.context, 'saturation-processor');
      this.multibandNode = new AudioWorkletNode(this.context, 'multiband-processor');
      this.midSideNode = new AudioWorkletNode(this.context, 'midside-processor');
      this.stereoImagerNode = new AudioWorkletNode(this.context, 'stereo-imager-processor');
      this.meteringNode = new AudioWorkletNode(this.context, 'metering-processor');

      this.compressorNode.port.onmessage = (e) => {
        if (e.data.type === 'gainReduction') {
          this.proMeter.compressorGR = e.data.value;
        }
      };
      this.limiterNode.port.onmessage = (e) => {
        if (e.data.type === 'gainReduction') {
          this.proMeter.limiterGR = e.data.value;
        }
      };
      this.multibandNode.port.onmessage = (e) => {
        if (e.data.type === 'bands') {
          this.proMeter.bandLevels = e.data.levels;
          this.proMeter.bandGR = e.data.gainReduction;
        }
      };
      this.meteringNode.port.onmessage = (e) => {
        if (e.data.type === 'meters') {
          this.proMeter.momentaryLUFS = e.data.momentaryLUFS;
          this.proMeter.shortTermLUFS = e.data.shortTermLUFS;
          this.proMeter.integratedLUFS = e.data.integratedLUFS;
          this.proMeter.truePeakL = e.data.truePeakL;
          this.proMeter.truePeakR = e.data.truePeakR;
          this.proMeter.peakHoldL = e.data.peakHoldL;
          this.proMeter.peakHoldR = e.data.peakHoldR;
          this.proMeter.rmsL = e.data.rmsL;
          this.proMeter.rmsR = e.data.rmsR;
          this.proMeter.phaseCorrelation = e.data.phaseCorrelation;
          this.proMeter.clipCount = (e.data.clipL ? 1 : 0) + (e.data.clipR ? 1 : 0);
          this.proMeter.lufs = e.data.momentaryLUFS;
          this.proMeter.peakL = e.data.truePeakL;
          this.proMeter.peakR = e.data.truePeakR;
        }
      };

      this.workletsLoaded = true;
    } catch {
      this.workletsLoaded = false;
    }
    this.connectChain();
  }

  connectWithFallback() {
    this.workletsLoaded = false;
    this.connectChain();
  }

  private connectChain() {
    // EQ chain
    this.input.connect(this.eqNodes[0]);
    for (let i = 1; i < this.eqNodes.length; i++) {
      this.eqNodes[i - 1].connect(this.eqNodes[i]);
    }
    const lastEQ = this.eqNodes[this.eqNodes.length - 1];

    if (this.workletsLoaded && this.compressorNode && this.limiterNode &&
        this.saturationNode && this.multibandNode && this.midSideNode && this.stereoImagerNode && this.meteringNode) {
      // Pro chain: EQ → Multiband → Compressor → Saturation → Mid/Side → Stereo Imager → Limiter → Gain → Metering → Output
      lastEQ.connect(this.multibandNode);
      this.multibandNode.connect(this.compressorNode);
      this.compressorNode.connect(this.saturationNode);
      this.saturationNode.connect(this.midSideNode);
      this.midSideNode.connect(this.stereoImagerNode);
      this.stereoImagerNode.connect(this.limiterNode);
      this.limiterNode.connect(this.gainNode);
      this.gainNode.connect(this.meteringNode);
      this.meteringNode.connect(this.splitter);
      this.splitter.connect(this.analyserL, 0);
      this.splitter.connect(this.analyserR, 1);
      this.meteringNode.connect(this.output);
    } else {
      // Fallback chain
      lastEQ.connect(this.fallbackCompressor);
      this.fallbackCompressor.connect(this.fallbackSaturation);
      this.fallbackSaturation.connect(this.fallbackLimiter);
      this.fallbackLimiter.connect(this.gainNode);
      this.gainNode.connect(this.splitter);
      this.splitter.connect(this.analyserL, 0);
      this.splitter.connect(this.analyserR, 1);
      this.gainNode.connect(this.output);
    }
  }

  updateProcessing(processing: MasterProcessing, bypass: boolean) {
    if (bypass || processing.bypass) {
      this.eqNodes.forEach((n) => {
        if (n.type === 'highpass' || n.type === 'lowpass') return;
        n.gain.value = 0;
      });
      this.gainNode.gain.value = 1;
      return;
    }

    // Map 3 EQ bands to our 6 (use center slots)
    processing.eq.forEach((band, i) => {
      const targetIdx = i + 1;
      if (this.eqNodes[targetIdx]) {
        this.eqNodes[targetIdx].type = band.type;
        this.eqNodes[targetIdx].frequency.value = band.frequency;
        this.eqNodes[targetIdx].gain.value = band.gain;
        this.eqNodes[targetIdx].Q.value = band.Q;
      }
    });

    if (this.workletsLoaded) {
      // Compressor
      if (this.compressorNode) {
        const p = this.compressorNode.parameters;
        this.setParam(p, 'threshold', processing.compressor.threshold);
        this.setParam(p, 'ratio', processing.compressor.ratio);
        this.setParam(p, 'attack', processing.compressor.attack);
        this.setParam(p, 'release', processing.compressor.release);
        this.setParam(p, 'knee', processing.compressor.knee);
        this.setParam(p, 'makeupGain', processing.compressor.makeupGain);
      }

      // Limiter
      if (this.limiterNode) {
        const p = this.limiterNode.parameters;
        this.setParam(p, 'ceiling', processing.limiter.threshold);
        this.setParam(p, 'release', processing.limiter.release);
      }

      // Saturation
      if (this.saturationNode) {
        const p = this.saturationNode.parameters;
        this.setParam(p, 'drive', processing.saturation.drive);
        this.setParam(p, 'mix', processing.saturation.mix);
      }

      // Mid/Side (stereo width)
      if (this.midSideNode) {
        const p = this.midSideNode.parameters;
        this.setParam(p, 'width', processing.stereoWidth.width);
      }

      // Stereo Imager
      if (this.stereoImagerNode && processing.stereoImager) {
        const p = this.stereoImagerNode.parameters;
        this.setParam(p, 'lowWidth', processing.stereoImager.lowWidth);
        this.setParam(p, 'midWidth', processing.stereoImager.midWidth);
        this.setParam(p, 'highWidth', processing.stereoImager.highWidth);
        this.setParam(p, 'bassMonoFreq', processing.stereoImager.bassMonoFreq);
        this.setParam(p, 'globalWidth', processing.stereoImager.globalWidth);
      }
    } else {
      this.fallbackCompressor.threshold.value = processing.compressor.threshold;
      this.fallbackCompressor.ratio.value = processing.compressor.ratio;
      this.fallbackCompressor.attack.value = processing.compressor.attack;
      this.fallbackCompressor.release.value = processing.compressor.release;
      this.fallbackCompressor.knee.value = processing.compressor.knee;
      this.fallbackLimiter.threshold.value = processing.limiter.threshold;
      this.fallbackLimiter.release.value = processing.limiter.release;
      this.applyFallbackSaturation(processing.saturation);
    }

    this.gainNode.gain.setTargetAtTime(Math.pow(10, processing.gain / 20), this.context.currentTime, 0.005);
  }

  /** Smooth master param changes (5 ms time constant). */
  private setParam(params: AudioParamMap, name: string, value: number) {
    const param = params.get(name);
    if (!param) return;
    try {
      param.setTargetAtTime(value, this.context.currentTime, 0.005);
    } catch {
      param.value = value;
    }
  }

  private applyFallbackSaturation(settings: SaturationSettings) {
    if (settings.drive <= 0) {
      this.fallbackSaturation.curve = null;
      return;
    }
    const samples = 44100;
    const curve = new Float32Array(samples);
    const drive = settings.drive * 10;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      const wet = Math.tanh(x * drive);
      curve[i] = x * (1 - settings.mix) + wet * settings.mix;
    }
    this.fallbackSaturation.curve = curve;
  }

  getMeterData(): MeterData {
    if (this.workletsLoaded) {
      return { ...this.proMeter };
    }
    // Fallback metering
    const bufferL = new Float32Array(this.analyserL.fftSize);
    const bufferR = new Float32Array(this.analyserR.fftSize);
    this.analyserL.getFloatTimeDomainData(bufferL);
    this.analyserR.getFloatTimeDomainData(bufferR);

    let peakL = 0, peakR = 0, rmsL = 0, rmsR = 0, clipCount = 0;
    for (let i = 0; i < bufferL.length; i++) {
      const absL = Math.abs(bufferL[i]);
      const absR = Math.abs(bufferR[i]);
      peakL = Math.max(peakL, absL);
      peakR = Math.max(peakR, absR);
      rmsL += bufferL[i] * bufferL[i];
      rmsR += bufferR[i] * bufferR[i];
      if (absL >= 1.0 || absR >= 1.0) clipCount++;
    }
    rmsL = Math.sqrt(rmsL / bufferL.length);
    rmsR = Math.sqrt(rmsR / bufferR.length);
    const rmsAvg = (rmsL + rmsR) / 2;

    return {
      peakL: peakL > 0 ? 20 * Math.log10(peakL) : -Infinity,
      peakR: peakR > 0 ? 20 * Math.log10(peakR) : -Infinity,
      rmsL: rmsL > 0 ? 20 * Math.log10(rmsL) : -Infinity,
      rmsR: rmsR > 0 ? 20 * Math.log10(rmsR) : -Infinity,
      lufs: rmsAvg > 0 ? 20 * Math.log10(rmsAvg) - 0.691 : -Infinity,
      clipCount,
    };
  }

  getProMeterData(): ProMeterData {
    return { ...this.proMeter };
  }

  /**
   * Clear the BS.1770-4 integrated-LUFS gated history so that the next
   * measurement reflects only the new program. Call at track change /
   * playback restart.
   */
  resetIntegratedLUFS() {
    if (this.meteringNode) {
      this.meteringNode.port.postMessage({ type: 'resetIntegrated' });
    }
    this.proMeter.integratedLUFS = -Infinity;
  }

  getSpectrumData(): Float32Array {
    const data = new Float32Array(this.analyserL.frequencyBinCount);
    this.analyserL.getFloatFrequencyData(data);
    return data;
  }

  destroy() {
    this.eqNodes.forEach((n) => { try { n.disconnect(); } catch {} });
    try { this.compressorNode?.disconnect(); } catch {}
    try { this.limiterNode?.disconnect(); } catch {}
    try { this.saturationNode?.disconnect(); } catch {}
    try { this.multibandNode?.disconnect(); } catch {}
    try { this.midSideNode?.disconnect(); } catch {}
    try { this.stereoImagerNode?.disconnect(); } catch {}
    try { this.meteringNode?.disconnect(); } catch {}
    try { this.fallbackCompressor.disconnect(); } catch {}
    try { this.fallbackLimiter.disconnect(); } catch {}
    try { this.fallbackSaturation.disconnect(); } catch {}
    try { this.gainNode.disconnect(); } catch {}
    try { this.splitter.disconnect(); } catch {}
    try { this.analyserL.disconnect(); } catch {}
    try { this.analyserR.disconnect(); } catch {}
    try { this.input.disconnect(); } catch {}
    try { this.output.disconnect(); } catch {}
  }
}

export class ProAudioEngine {
  public context: AudioContext;
  public stemChannels: Map<string, ProStemChannel> = new Map();
  public busChannels: Map<BusId, ProBusChannel> = new Map();
  public stemBusMap: Map<string, BusId> = new Map();
  public reverbReturn: ProFxReturn;
  public delayReturn: ProFxReturn;
  private stemSendGains: Map<string, { reverb: GainNode; delay: GainNode }> = new Map();
  public masterChannel: ProMasterChannel;
  private isPlaying = false;
  private startTime = 0;
  private pauseOffset = 0;
  private loopEnabled = false;
  private loopStart = 0;
  private loopEnd = 0;
  public workletsReady = false;
  /** Optional clip list used by offline render (set by caller before export). */
  public exportClips: AudioClip[] | null = null;
  /** Optional bus states used by offline render (set by caller before export). */
  public exportBuses: BusState[] | null = null;

  constructor() {
    this.context = new AudioContext();
    this.masterChannel = new ProMasterChannel(this.context);
    this.masterChannel.output.connect(this.context.destination);

    for (const id of ALL_BUS_IDS) {
      const bus = new ProBusChannel(this.context);
      bus.output.connect(this.masterChannel.input);
      this.busChannels.set(id, bus);
    }

    this.reverbReturn = new ProFxReturn(this.context, 'reverb');
    this.delayReturn = new ProFxReturn(this.context, 'delay');
    this.reverbReturn.output.connect(this.masterChannel.input);
    this.delayReturn.output.connect(this.masterChannel.input);
  }

  async loadWorklets(): Promise<boolean> {
    try {
      await this.context.audioWorklet.addModule('/worklets/compressor-processor.js');
      await this.context.audioWorklet.addModule('/worklets/limiter-processor.js');
      await this.context.audioWorklet.addModule('/worklets/saturation-processor.js');
      await this.context.audioWorklet.addModule('/worklets/multiband-processor.js');
      await this.context.audioWorklet.addModule('/worklets/midside-processor.js');
      await this.context.audioWorklet.addModule('/worklets/metering-processor.js');
      await this.context.audioWorklet.addModule('/worklets/linear-phase-eq-processor.js');
      await this.context.audioWorklet.addModule('/worklets/oversampled-saturation-processor.js');
      await this.context.audioWorklet.addModule('/worklets/dynamic-eq-processor.js');
      await this.context.audioWorklet.addModule('/worklets/sidechain-compressor-processor.js');
      await this.context.audioWorklet.addModule('/worklets/transient-designer-processor.js');
      await this.context.audioWorklet.addModule('/worklets/gate-expander-processor.js');
      await this.context.audioWorklet.addModule('/worklets/stereo-imager-processor.js');
      this.workletsReady = true;
      await this.masterChannel.initWorklets();
      return true;
    } catch (err) {
      console.warn('AudioWorklets not available, using fallback DSP:', err);
      this.workletsReady = false;
      this.masterChannel.connectWithFallback();
      return false;
    }
  }

  async resume() {
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  setLoop(enabled: boolean, start = 0, end = 0) {
    this.loopEnabled = enabled;
    this.loopStart = Math.max(0, start);
    this.loopEnd = Math.max(this.loopStart, end);
  }

  getLoopEnabled(): boolean {
    return this.loopEnabled;
  }

  getLoopStart(): number {
    return this.loopStart;
  }

  getLoopEnd(): number {
    return this.loopEnd;
  }

  async addStem(id: string, buffer: AudioBuffer, busId: BusId = 'music'): Promise<ProStemChannel> {
    const channel = new ProStemChannel(this.context);
    channel.setBuffer(buffer);

    if (this.workletsReady) {
      await channel.initWorklets();
    } else {
      channel.connectWithFallback();
    }

    const bus = this.busChannels.get(busId) ?? this.busChannels.get('music')!;
    channel.output.connect(bus.input);
    this.stemBusMap.set(id, busId);

    const reverbSend = this.context.createGain();
    const delaySend = this.context.createGain();
    reverbSend.gain.value = 0;
    delaySend.gain.value = 0;
    channel.preSendTap.connect(reverbSend);
    channel.preSendTap.connect(delaySend);
    reverbSend.connect(this.reverbReturn.input);
    delaySend.connect(this.delayReturn.input);
    this.stemSendGains.set(id, { reverb: reverbSend, delay: delaySend });

    this.stemChannels.set(id, channel);
    return channel;
  }

  routeStemToBus(stemId: string, busId: BusId) {
    const channel = this.stemChannels.get(stemId);
    if (!channel) return;
    const prev = this.stemBusMap.get(stemId);
    if (prev) {
      const prevBus = this.busChannels.get(prev);
      try {
        channel.output.disconnect(prevBus?.input ?? this.masterChannel.input);
      } catch {
        try {
          channel.output.disconnect();
        } catch {
          /* */
        }
      }
    }
    const bus = this.busChannels.get(busId) ?? this.busChannels.get('music')!;
    channel.output.connect(bus.input);
    this.stemBusMap.set(stemId, busId);
  }

  setBusGain(busId: BusId, gainDb: number) {
    this.busChannels.get(busId)?.setGainDb(gainDb);
  }

  setBusMute(busId: BusId, mute: boolean) {
    this.busChannels.get(busId)?.setMute(mute);
  }

  setStemSend(stemId: string, fx: SendFxId, level: number) {
    const sends = this.stemSendGains.get(stemId);
    if (!sends) return;
    const g = Math.max(0, Math.min(1, level));
    if (fx === 'reverb') sends.reverb.gain.value = g;
    else sends.delay.gain.value = g;
  }

  removeStem(id: string) {
    const channel = this.stemChannels.get(id);
    if (channel) {
      channel.destroy();
      this.stemChannels.delete(id);
    }
    const sends = this.stemSendGains.get(id);
    if (sends) {
      try { sends.reverb.disconnect(); } catch {}
      try { sends.delay.disconnect(); } catch {}
      this.stemSendGains.delete(id);
    }
    this.stemBusMap.delete(id);
  }

  /** Route sidechain: sourceId's audio drives compression on targetId */
  connectSidechain(sourceId: string, targetId: string) {
    const source = this.stemChannels.get(sourceId);
    const target = this.stemChannels.get(targetId);
    if (source && target) {
      target.connectSidechainFrom(source);
    }
  }

  disconnectSidechain(targetId: string) {
    const target = this.stemChannels.get(targetId);
    if (target) {
      target.disconnectSidechain();
    }
  }

  updateSidechainParams(targetId: string, params: {
    threshold?: number;
    ratio?: number;
    attack?: number;
    release?: number;
    range?: number;
    mix?: number;
    filterFreq?: number;
    filterType?: number;
    filterQ?: number;
  }) {
    const target = this.stemChannels.get(targetId);
    if (target) {
      target.updateSidechainParams(params);
    }
  }

  updateTransientParams(stemId: string, params: {
    attack?: number;
    sustain?: number;
    speed?: number;
    sensitivity?: number;
    mix?: number;
  }) {
    const ch = this.stemChannels.get(stemId);
    if (ch) ch.updateTransientParams(params);
  }

  updateGateParams(stemId: string, params: {
    threshold?: number;
    ratio?: number;
    attack?: number;
    hold?: number;
    release?: number;
    range?: number;
    hysteresis?: number;
  }) {
    const ch = this.stemChannels.get(stemId);
    if (ch) ch.updateGateParams(params);
  }

  play(offset?: number) {
    this.resume();
    const playOffset = offset ?? this.pauseOffset;
    // Reset BS.1770-4 integrated history when starting from the top so the
    // reading reflects only this program (no cross-session accumulation).
    if (playOffset <= 0.001) {
      this.masterChannel.resetIntegratedLUFS();
    }
    this.stemChannels.forEach((ch) => ch.play(playOffset));
    this.startTime = this.context.currentTime - playOffset;
    this.isPlaying = true;
  }

  stop() {
    this.stemChannels.forEach((ch) => ch.stop());
    this.pauseOffset = 0;
    this.isPlaying = false;
  }

  pause() {
    if (this.isPlaying) {
      this.pauseOffset = this.context.currentTime - this.startTime;
      this.stemChannels.forEach((ch) => ch.stop());
      this.isPlaying = false;
    }
  }

  getCurrentTime(): number {
    if (this.isPlaying) return this.context.currentTime - this.startTime;
    return this.pauseOffset;
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  async decodeFile(file: File): Promise<AudioBuffer> {
    const arrayBuffer = await file.arrayBuffer();
    return this.context.decodeAudioData(arrayBuffer);
  }

  static generateWaveformData(buffer: AudioBuffer, width: number): Float32Array {
    const channel = buffer.getChannelData(0);
    const step = Math.ceil(channel.length / width);
    const waveform = new Float32Array(width);
    for (let i = 0; i < width; i++) {
      let max = 0;
      const start = i * step;
      for (let j = start; j < start + step && j < channel.length; j++) {
        const abs = Math.abs(channel[j]);
        if (abs > max) max = abs;
      }
      waveform[i] = max;
    }
    return waveform;
  }

  /**
   * Render the full pro DSP chain (per-stem + master) through an
   * OfflineAudioContext using the same AudioWorklets as realtime playback.
   * This is the industry-standard WYSIWYG path: what you hear is what you
   * export.
   *
   * If worklet registration fails (rare \u2014 some browsers without OfflineAudioContext
   * worklet support), falls back to native-node rendering.
   */
  private async renderPro(
    stems: Stem[],
    masterProcessing: MasterProcessing,
    duration: number,
    sampleRate: number,
    onProgress?: (progress: number) => void
  ): Promise<AudioBuffer> {
    const offlineCtx = new OfflineAudioContext(2, Math.max(1, Math.ceil(sampleRate * duration)), sampleRate);

    // Attempt to load all worklets into the offline context.
    // AudioWorklets DO work in OfflineAudioContext since Chrome 66 / Firefox 76.
    let workletsOk = false;
    try {
      const base = '/worklets/';
      const modules = [
        'compressor-processor.js', 'limiter-processor.js', 'saturation-processor.js',
        'multiband-processor.js', 'midside-processor.js', 'metering-processor.js',
        'linear-phase-eq-processor.js', 'oversampled-saturation-processor.js',
        'dynamic-eq-processor.js', 'sidechain-compressor-processor.js',
        'transient-designer-processor.js', 'gate-expander-processor.js',
        'stereo-imager-processor.js',
      ];
      await Promise.all(modules.map((m) => offlineCtx.audioWorklet.addModule(base + m)));
      workletsOk = true;
    } catch (err) {
      console.warn('Offline worklet loading failed, falling back to native nodes:', err);
    }

    // Build master chain into a bus gain node that feeds the destination.
    const masterIn = offlineCtx.createGain();
    const buildMaster = workletsOk
      ? this.buildOfflineMasterChain(offlineCtx, masterProcessing)
      : this.buildFallbackMasterChain(offlineCtx, masterProcessing);
    masterIn.connect(buildMaster.input);
    buildMaster.output.connect(offlineCtx.destination);

    // Offline bus mixers (gain + mute + solo), summed into master.
    const busMap = new Map<BusId, GainNode>();
    const busStates = this.exportBuses;
    const anyBusSolo = !!busStates?.some((b) => b.solo);
    const soloedBuses = new Set((busStates ?? []).filter((b) => b.solo).map((b) => b.id));
    for (const id of ALL_BUS_IDS) {
      const node = offlineCtx.createGain();
      const state = busStates?.find((b) => b.id === id);
      const soloMuted = anyBusSolo && !soloedBuses.has(id);
      if (state?.mute || soloMuted) {
        node.gain.value = 0;
      } else {
        const db = state?.gain ?? 0;
        node.gain.value = Math.pow(10, db / 20);
      }
      node.connect(masterIn);
      busMap.set(id, node);
    }

    // Shared crude FX returns → master
    const delayIn = offlineCtx.createGain();
    {
      const delay = offlineCtx.createDelay(1.0);
      delay.delayTime.value = 0.25;
      const fb = offlineCtx.createGain();
      fb.gain.value = 0.25;
      const lp = offlineCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 4500;
      const delayOut = offlineCtx.createGain();
      delayOut.gain.value = 0.35;
      delayIn.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(delayOut);
      delayOut.connect(masterIn);
    }
    const reverbIn = offlineCtx.createGain();
    {
      const sum = offlineCtx.createGain();
      sum.gain.value = 0.35;
      const lp = offlineCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6000;
      const reverbOut = offlineCtx.createGain();
      reverbOut.gain.value = 0.3;
      for (const t of [0.029, 0.037, 0.053, 0.079]) {
        const d = offlineCtx.createDelay(0.2);
        d.delayTime.value = t;
        reverbIn.connect(d);
        d.connect(sum);
      }
      sum.connect(lp);
      lp.connect(reverbOut);
      reverbOut.connect(masterIn);
    }

    const clips = this.exportClips;

    const scheduleClipSource = (
      buffer: AudioBuffer,
      clip: AudioClip,
      destination: AudioNode
    ) => {
      const src = offlineCtx.createBufferSource();
      src.buffer = buffer;
      const env = offlineCtx.createGain();
      const g = Math.max(0, clip.gain ?? 1);
      const start = Math.max(0, clip.startTime);
      const dur = Math.max(0.001, clip.duration);
      const offset = Math.max(0, clip.offset);
      const fadeIn = Math.max(0, Math.min(clip.fadeIn || 0, dur));
      const fadeOut = Math.max(0, Math.min(clip.fadeOut || 0, dur - fadeIn));

      env.gain.setValueAtTime(fadeIn > 0 ? 0 : g, start);
      if (fadeIn > 0) {
        env.gain.linearRampToValueAtTime(g, start + fadeIn);
      }
      if (fadeOut > 0) {
        const fadeOutStart = start + dur - fadeOut;
        env.gain.setValueAtTime(g, Math.max(start, fadeOutStart));
        env.gain.linearRampToValueAtTime(0, start + dur);
      }

      src.connect(env);
      env.connect(destination);
      src.start(start, offset, dur);
    };

    // Build each stem chain and connect into its bus (+ crude sends).
    for (const stem of stems) {
      if (!stem.audioBuffer || stem.processing.mute) continue;

      const busId = stem.busId ?? defaultBusIdForStem(stem.type, stem.trackRole);
      const busNode = busMap.get(busId) ?? busMap.get('music')!;

      const chain = workletsOk
        ? this.buildOfflineStemChain(offlineCtx, stem.processing)
        : this.buildFallbackStemChain(offlineCtx, stem.processing);

      chain.output.connect(busNode);

      const stemClips = clips?.filter((c) => c.stemId === stem.id) ?? [];
      if (stemClips.length > 0) {
        for (const clip of stemClips) {
          scheduleClipSource(stem.audioBuffer, clip, chain.input);
        }
      } else {
        const src = offlineCtx.createBufferSource();
        src.buffer = stem.audioBuffer;
        src.connect(chain.input);
        src.start(0);
      }

      // Crude wet sends: duplicate dry path at send level into shared FX
      const revLvl = Math.max(0, Math.min(1, stem.sends?.reverb ?? 0));
      const delLvl = Math.max(0, Math.min(1, stem.sends?.delay ?? 0));
      if (revLvl > 0.001 || delLvl > 0.001) {
        const sendTap = offlineCtx.createGain();
        chain.output.connect(sendTap);
        if (revLvl > 0.001) {
          const g = offlineCtx.createGain();
          g.gain.value = revLvl;
          sendTap.connect(g);
          g.connect(reverbIn);
        }
        if (delLvl > 0.001) {
          const g = offlineCtx.createGain();
          g.gain.value = delLvl;
          sendTap.connect(g);
          g.connect(delayIn);
        }
      }
    }

    if (onProgress) onProgress(30);
    const rendered = await offlineCtx.startRendering();
    if (onProgress) onProgress(70);
    return rendered;
  }

  /** Per-stem pro chain: EQ \u2192 Gate \u2192 Compressor \u2192 Saturation \u2192 Transient \u2192 Gain \u2192 Pan */
  private buildOfflineStemChain(
    ctx: OfflineAudioContext,
    proc: StemProcessing
  ): { input: AudioNode; output: AudioNode } {
    // 6-band biquad EQ mirror of ProStemChannel.initEQ
    const bandSpec: { frequency: number; type: BiquadFilterType }[] = [
      { frequency: 60, type: 'highpass' },
      { frequency: 200, type: 'lowshelf' },
      { frequency: 800, type: 'peaking' },
      { frequency: 2500, type: 'peaking' },
      { frequency: 6000, type: 'peaking' },
      { frequency: 12000, type: 'highshelf' },
    ];
    const eqNodes = bandSpec.map((b) => {
      const n = ctx.createBiquadFilter();
      n.type = b.type;
      n.frequency.value = b.frequency;
      n.gain.value = 0;
      n.Q.value = 1;
      return n;
    });
    // Map processing.eq onto bands 1..3 (skipping HPF at 0)
    proc.eq.forEach((band, i) => {
      const t = i + 1;
      if (eqNodes[t]) {
        eqNodes[t].type = band.type;
        eqNodes[t].frequency.value = band.frequency;
        eqNodes[t].gain.value = band.gain;
        eqNodes[t].Q.value = band.Q;
      }
    });
    for (let i = 1; i < eqNodes.length; i++) eqNodes[i - 1].connect(eqNodes[i]);

    // Worklet nodes (worklets guaranteed loaded at this call site)
    const gate = new AudioWorkletNode(ctx as unknown as BaseAudioContext, 'gate-expander-processor');
    const comp = new AudioWorkletNode(ctx as unknown as BaseAudioContext, 'compressor-processor');
    const sat = new AudioWorkletNode(ctx as unknown as BaseAudioContext, 'saturation-processor');
    const trans = new AudioWorkletNode(ctx as unknown as BaseAudioContext, 'transient-designer-processor');

    const applyParam = (p: AudioParamMap, name: string, v: number) => {
      const param = p.get(name);
      if (param) param.value = v;
    };
    // Compressor
    applyParam(comp.parameters, 'threshold', proc.compressor.threshold);
    applyParam(comp.parameters, 'ratio', proc.compressor.ratio);
    applyParam(comp.parameters, 'attack', proc.compressor.attack);
    applyParam(comp.parameters, 'release', proc.compressor.release);
    applyParam(comp.parameters, 'knee', proc.compressor.knee);
    applyParam(comp.parameters, 'makeupGain', proc.compressor.makeupGain);
    // Saturation
    applyParam(sat.parameters, 'drive', proc.saturation.drive);
    applyParam(sat.parameters, 'mix', proc.saturation.mix);

    const gainN = ctx.createGain();
    gainN.gain.value = Math.pow(10, proc.gain / 20);
    const panN = ctx.createStereoPanner();
    panN.pan.value = proc.pan;

    // Connect
    const lastEQ = eqNodes[eqNodes.length - 1];
    lastEQ.connect(gate);
    gate.connect(comp);
    comp.connect(sat);
    sat.connect(trans);
    trans.connect(gainN);
    gainN.connect(panN);

    return { input: eqNodes[0], output: panN };
  }

  /** Master pro chain: EQ \u2192 Multiband \u2192 Compressor \u2192 Saturation \u2192 MidSide \u2192 StereoImager \u2192 Limiter \u2192 Gain */
  private buildOfflineMasterChain(
    ctx: OfflineAudioContext,
    proc: MasterProcessing
  ): { input: AudioNode; output: AudioNode } {
    const bandSpec: { frequency: number; type: BiquadFilterType }[] = [
      { frequency: 30, type: 'highpass' },
      { frequency: 80, type: 'lowshelf' },
      { frequency: 400, type: 'peaking' },
      { frequency: 1000, type: 'peaking' },
      { frequency: 4000, type: 'peaking' },
      { frequency: 8000, type: 'highshelf' },
    ];
    const eqNodes = bandSpec.map((b) => {
      const n = ctx.createBiquadFilter();
      n.type = b.type;
      n.frequency.value = b.frequency;
      n.gain.value = 0;
      n.Q.value = 0.707;
      return n;
    });
    proc.eq.forEach((band, i) => {
      const t = i + 1;
      if (eqNodes[t]) {
        eqNodes[t].type = band.type;
        eqNodes[t].frequency.value = band.frequency;
        eqNodes[t].gain.value = band.gain;
        eqNodes[t].Q.value = band.Q;
      }
    });
    for (let i = 1; i < eqNodes.length; i++) eqNodes[i - 1].connect(eqNodes[i]);

    const multiband = new AudioWorkletNode(ctx as unknown as BaseAudioContext, 'multiband-processor');
    const comp = new AudioWorkletNode(ctx as unknown as BaseAudioContext, 'compressor-processor');
    const sat = new AudioWorkletNode(ctx as unknown as BaseAudioContext, 'saturation-processor');
    const midside = new AudioWorkletNode(ctx as unknown as BaseAudioContext, 'midside-processor');
    const imager = new AudioWorkletNode(ctx as unknown as BaseAudioContext, 'stereo-imager-processor');
    const limiter = new AudioWorkletNode(ctx as unknown as BaseAudioContext, 'limiter-processor');

    const applyParam = (p: AudioParamMap, name: string, v: number) => {
      const param = p.get(name);
      if (param) param.value = v;
    };

    applyParam(comp.parameters, 'threshold', proc.compressor.threshold);
    applyParam(comp.parameters, 'ratio', proc.compressor.ratio);
    applyParam(comp.parameters, 'attack', proc.compressor.attack);
    applyParam(comp.parameters, 'release', proc.compressor.release);
    applyParam(comp.parameters, 'knee', proc.compressor.knee);
    applyParam(comp.parameters, 'makeupGain', proc.compressor.makeupGain);
    applyParam(sat.parameters, 'drive', proc.saturation.drive);
    applyParam(sat.parameters, 'mix', proc.saturation.mix);
    applyParam(midside.parameters, 'width', proc.stereoWidth.width);
    if (proc.stereoImager) {
      applyParam(imager.parameters, 'lowWidth', proc.stereoImager.lowWidth);
      applyParam(imager.parameters, 'midWidth', proc.stereoImager.midWidth);
      applyParam(imager.parameters, 'highWidth', proc.stereoImager.highWidth);
      applyParam(imager.parameters, 'bassMonoFreq', proc.stereoImager.bassMonoFreq);
      applyParam(imager.parameters, 'globalWidth', proc.stereoImager.globalWidth);
    }
    applyParam(limiter.parameters, 'ceiling', proc.limiter.threshold);
    applyParam(limiter.parameters, 'release', proc.limiter.release);

    const gainN = ctx.createGain();
    gainN.gain.value = Math.pow(10, proc.gain / 20);

    const lastEQ = eqNodes[eqNodes.length - 1];
    lastEQ.connect(multiband);
    multiband.connect(comp);
    comp.connect(sat);
    sat.connect(midside);
    midside.connect(imager);
    imager.connect(limiter);
    limiter.connect(gainN);

    return { input: eqNodes[0], output: gainN };
  }

  /** Fallback chain used when OfflineAudioContext can't load worklets. */
  private buildFallbackStemChain(
    ctx: OfflineAudioContext,
    proc: StemProcessing
  ): { input: AudioNode; output: AudioNode } {
    const gain = ctx.createGain();
    gain.gain.value = Math.pow(10, proc.gain / 20);
    const pan = ctx.createStereoPanner();
    pan.pan.value = proc.pan;
    gain.connect(pan);
    return { input: gain, output: pan };
  }

  private buildFallbackMasterChain(
    ctx: OfflineAudioContext,
    proc: MasterProcessing
  ): { input: AudioNode; output: AudioNode } {
    const input = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    const lim = ctx.createDynamicsCompressor();
    lim.ratio.value = 20; lim.knee.value = 0; lim.attack.value = 0.001;
    comp.threshold.value = proc.compressor.threshold;
    comp.ratio.value = proc.compressor.ratio;
    comp.attack.value = proc.compressor.attack;
    comp.release.value = proc.compressor.release;
    comp.knee.value = proc.compressor.knee;
    lim.threshold.value = proc.limiter.threshold;
    lim.release.value = proc.limiter.release;
    const gain = ctx.createGain();
    gain.gain.value = Math.pow(10, proc.gain / 20);
    input.connect(comp); comp.connect(lim); lim.connect(gain);
    return { input, output: gain };
  }

  async exportWAV(
    stems: Stem[],
    masterProcessing: MasterProcessing,
    duration: number,
    bitDepth: ExportBitDepth = 24,
    dither: DitherType = 'noise-shaped',
    onProgress?: (progress: number) => void
  ): Promise<Blob> {
    const sampleRate = 44100;
    const renderedBuffer = await this.renderPro(
      stems, masterProcessing, duration, sampleRate, onProgress
    );
    const wav = this.bufferToWAV(renderedBuffer, bitDepth, dither);
    if (onProgress) onProgress(100);
    return new Blob([wav], { type: 'audio/wav' });
  }

  private bufferToWAV(
    buffer: AudioBuffer,
    bitDepth: ExportBitDepth = 24,
    dither: DitherType = 'noise-shaped'
  ): ArrayBuffer {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const isFloat = bitDepth === 32;
    const format = isFloat ? 3 : 1; // WAVE_FORMAT_IEEE_FLOAT=3, WAVE_FORMAT_PCM=1
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataLength = buffer.length * blockAlign;

    // IEEE float WAV requires an 18-byte fmt chunk (with cbSize=0) plus a
    // 12-byte 'fact' chunk (§3 of WAVE-FORMAT-IEEE-FLOAT spec). Strict
    // parsers (Audacity validator, some DAWs) reject float WAVs without
    // these chunks.
    const fmtChunkBodySize = isFloat ? 18 : 16;
    const factChunkSize = isFloat ? 12 : 0; // 'fact' + size + sampleCount
    const headerLength = 8 /*RIFF*/ + 4 /*WAVE*/
                        + 8 /*fmt hdr*/ + fmtChunkBodySize
                        + factChunkSize
                        + 8 /*data hdr*/;
    const totalLength = headerLength + dataLength;

    const arrayBuffer = new ArrayBuffer(totalLength);
    const view = new DataView(arrayBuffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    // RIFF header
    writeString(0, 'RIFF');
    view.setUint32(4, totalLength - 8, true);
    writeString(8, 'WAVE');

    // fmt chunk
    writeString(12, 'fmt ');
    view.setUint32(16, fmtChunkBodySize, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    let cursor = 36;
    if (isFloat) {
      // cbSize = 0 (no extra fmt data)
      view.setUint16(cursor, 0, true);
      cursor += 2;
      // fact chunk
      writeString(cursor, 'fact');
      view.setUint32(cursor + 4, 4, true);            // chunk body size
      view.setUint32(cursor + 8, buffer.length, true); // dwSampleLength
      cursor += 12;
    }

    // data chunk
    writeString(cursor, 'data');
    view.setUint32(cursor + 4, dataLength, true);
    cursor += 8;
    const dataStart = cursor;

    const channels: Float32Array[] = [];
    for (let i = 0; i < numChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    // Noise-shaping error feedback state per channel
    // 2nd-order noise shaping pushes dither noise above audible range
    const nsError1 = new Float64Array(numChannels); // e[n-1]
    const nsError2 = new Float64Array(numChannels); // e[n-2]

    // Noise-shaping coefficients (F-weighted, optimized for 44.1/48kHz)
    // Based on psychoacoustic model pushing noise above ~14kHz
    const nsC1 = 1.623;
    const nsC2 = -0.982;

    let offset = dataStart;
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        let sample: number = channels[ch][i];
        sample = Math.max(-1, Math.min(1, sample));

        if (bitDepth === 32) {
          // 32-bit float — no dithering needed
          view.setFloat32(offset, sample, true);
        } else if (bitDepth === 24) {
          const scale = 8388607;
          const invScale = 1.0 / scale;

          if (dither === 'noise-shaped') {
            // Feed back shaped error into signal
            const shaped = sample - nsC1 * nsError1[ch] - nsC2 * nsError2[ch];
            // TPDF dither
            const d = (Math.random() - Math.random()) * invScale;
            const quantized = Math.round((shaped + d) * scale);
            const clamped = Math.max(-8388608, Math.min(8388607, quantized));
            // Compute quantization error
            const quantError = sample - clamped * invScale;
            nsError2[ch] = nsError1[ch];
            nsError1[ch] = quantError;
            view.setUint8(offset, clamped & 0xff);
            view.setUint8(offset + 1, (clamped >> 8) & 0xff);
            view.setUint8(offset + 2, (clamped >> 16) & 0xff);
          } else if (dither === 'tpdf') {
            const d = (Math.random() - Math.random()) * invScale;
            sample += d;
            sample = Math.max(-1, Math.min(1, sample));
            const intSample = Math.round(sample * scale);
            const clamped = Math.max(-8388608, Math.min(8388607, intSample));
            view.setUint8(offset, clamped & 0xff);
            view.setUint8(offset + 1, (clamped >> 8) & 0xff);
            view.setUint8(offset + 2, (clamped >> 16) & 0xff);
          } else {
            // No dither (truncate)
            const intSample = Math.round(sample * scale);
            const clamped = Math.max(-8388608, Math.min(8388607, intSample));
            view.setUint8(offset, clamped & 0xff);
            view.setUint8(offset + 1, (clamped >> 8) & 0xff);
            view.setUint8(offset + 2, (clamped >> 16) & 0xff);
          }
        } else {
          // 16-bit
          const scale = 32767;
          const invScale = 1.0 / scale;

          if (dither === 'noise-shaped') {
            const shaped = sample - nsC1 * nsError1[ch] - nsC2 * nsError2[ch];
            const d = (Math.random() - Math.random()) * invScale;
            const quantized = Math.round((shaped + d) * scale);
            const clamped = Math.max(-32768, Math.min(32767, quantized));
            const quantError = sample - clamped * invScale;
            nsError2[ch] = nsError1[ch];
            nsError1[ch] = quantError;
            view.setInt16(offset, clamped, true);
          } else if (dither === 'tpdf') {
            const d = (Math.random() - Math.random()) * invScale;
            sample += d;
            sample = Math.max(-1, Math.min(1, sample));
            const clamped = Math.max(-32768, Math.min(32767, Math.round(sample * scale)));
            view.setInt16(offset, clamped, true);
          } else {
            // No dither \u2014 truncate (consistent symmetric scaling with MP3 path)
            const clamped = Math.max(-32768, Math.min(32767, Math.round(sample * scale)));
            view.setInt16(offset, clamped, true);
          }
        }
        offset += bytesPerSample;
      }
    }

    return arrayBuffer;
  }

  async exportMP3(
    stems: Stem[],
    masterProcessing: MasterProcessing,
    duration: number,
    kbps: number = 320,
    onProgress?: (progress: number) => void
  ): Promise<Blob> {
    const sampleRate = 44100;
    // Render through the same pro DSP chain as realtime (WYSIWYG).
    const renderedBuffer = await this.renderPro(
      stems, masterProcessing, duration, sampleRate,
      (p) => onProgress?.(Math.min(50, p * 0.5))
    );
    if (onProgress) onProgress(50);

    // Encode MP3 using lamejs (dynamic import hidden from webpack static analysis)
    try {
      // @ts-ignore — dynamic require to avoid webpack bundling issues
      const importFn = new Function('m', 'return import(m)');
      const lamejs = await importFn(/* webpackIgnore: true */ 'lamejs').catch(() => null);
      if (!lamejs) throw new Error('lamejs not available');
      const mp3encoder = new lamejs.Mp3Encoder(2, sampleRate, kbps);
      const mp3Data: Int8Array[] = [];

      const left = renderedBuffer.getChannelData(0);
      const right = renderedBuffer.numberOfChannels > 1 ? renderedBuffer.getChannelData(1) : left;
      const blockSize = 1152;

      for (let i = 0; i < left.length; i += blockSize) {
        const leftChunk = new Int16Array(Math.min(blockSize, left.length - i));
        const rightChunk = new Int16Array(Math.min(blockSize, right.length - i));

        for (let j = 0; j < leftChunk.length; j++) {
          leftChunk[j] = Math.max(-32768, Math.min(32767, Math.round(left[i + j] * 32767)));
          rightChunk[j] = Math.max(-32768, Math.min(32767, Math.round(right[i + j] * 32767)));
        }

        const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
        if (mp3buf.length > 0) mp3Data.push(new Int8Array(mp3buf));

        if (onProgress) onProgress(50 + (i / left.length) * 45);
      }

      const finalBuf = mp3encoder.flush();
      if (finalBuf.length > 0) mp3Data.push(new Int8Array(finalBuf));

      if (onProgress) onProgress(100);

      const totalLength = mp3Data.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      mp3Data.forEach((chunk) => {
        result.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), offset);
        offset += chunk.length;
      });

      return new Blob([result], { type: 'audio/mpeg' });
    } catch (err) {
      console.error('MP3 encoding failed, falling back to WAV:', err);
      // Fallback to WAV if lamejs not available
      const wav = this.bufferToWAV(renderedBuffer, 16, 'tpdf');
      return new Blob([wav], { type: 'audio/wav' });
    }
  }

  /**
   * FLAC export stub. Real FLAC encoding requires a WASM encoder (e.g.
   * flac.js or libflac-js) which this project doesn't ship; previously this
   * method returned a WAV blob with `audio/flac` MIME, which no FLAC decoder
   * will play and is user-deceiving.
   *
   * Honest fallback: produce an actual lossless WAV. The returned blob
   * carries `audio/wav` MIME and the caller should name the download
   * accordingly (use `blob.type` to decide the file extension).
   */
  async exportFLAC(
    stems: Stem[],
    masterProcessing: MasterProcessing,
    duration: number,
    bitDepth: ExportBitDepth = 24,
    dither: DitherType = 'noise-shaped',
    onProgress?: (progress: number) => void
  ): Promise<Blob> {
    const wavBlob = await this.exportWAV(stems, masterProcessing, duration, bitDepth, dither, onProgress);
    // Keep the WAV MIME \u2014 truthful lossless audio. Caller should suffix .wav.
    return wavBlob;
  }

  async exportStem(
    stem: Stem,
    masterProcessing: MasterProcessing,
    duration: number,
    bitDepth: ExportBitDepth = 24,
    dither: DitherType = 'noise-shaped',
    onProgress?: (progress: number) => void
  ): Promise<Blob> {
    if (!stem.audioBuffer) throw new Error('No audio buffer for stem');

    const sampleRate = 44100;
    const offlineCtx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const source = offlineCtx.createBufferSource();
    source.buffer = stem.audioBuffer;
    const gain = offlineCtx.createGain();
    gain.gain.value = Math.pow(10, stem.processing.gain / 20);
    const pan = offlineCtx.createStereoPanner();
    pan.pan.value = stem.processing.pan;

    source.connect(gain);
    gain.connect(pan);
    pan.connect(offlineCtx.destination);
    source.start(0);

    if (onProgress) onProgress(20);
    const renderedBuffer = await offlineCtx.startRendering();
    if (onProgress) onProgress(70);

    const wav = this.bufferToWAV(renderedBuffer, bitDepth, dither);
    if (onProgress) onProgress(100);
    return new Blob([wav], { type: 'audio/wav' });
  }

  destroy() {
    this.stemChannels.forEach((ch) => ch.destroy());
    this.stemChannels.clear();
    this.masterChannel.destroy();
    this.context.close();
  }
}
