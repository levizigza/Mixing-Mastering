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
} from '@/types/audio';

export class StemChannel {
  private context: AudioContext;
  private sourceNode: AudioBufferSourceNode | null = null;
  private eqNodes: BiquadFilterNode[] = [];
  private compressorNode: DynamicsCompressorNode;
  private saturationNode: WaveShaperNode;
  private gainNode: GainNode;
  private panNode: StereoPannerNode;
  private analyserNode: AnalyserNode;
  private muteGainNode: GainNode;
  public output: GainNode;
  private buffer: AudioBuffer | null = null;
  private startOffset = 0;

  constructor(context: AudioContext) {
    this.context = context;

    this.compressorNode = context.createDynamicsCompressor();
    this.saturationNode = context.createWaveShaper();
    this.saturationNode.oversample = '4x';
    this.gainNode = context.createGain();
    this.panNode = context.createStereoPanner();
    this.analyserNode = context.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.smoothingTimeConstant = 0.8;
    this.muteGainNode = context.createGain();
    this.output = context.createGain();

    this.initEQ();
    this.connectChain();
  }

  private initEQ() {
    const bands: { frequency: number; type: BiquadFilterType }[] = [
      { frequency: 200, type: 'lowshelf' },
      { frequency: 1000, type: 'peaking' },
      { frequency: 5000, type: 'highshelf' },
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

  private connectChain() {
    let chain: AudioNode = this.eqNodes[0];
    for (let i = 1; i < this.eqNodes.length; i++) {
      this.eqNodes[i - 1].connect(this.eqNodes[i]);
      chain = this.eqNodes[i];
    }
    chain.connect(this.compressorNode);
    this.compressorNode.connect(this.saturationNode);
    this.saturationNode.connect(this.gainNode);
    this.gainNode.connect(this.panNode);
    this.panNode.connect(this.muteGainNode);
    this.muteGainNode.connect(this.analyserNode);
    this.analyserNode.connect(this.output);
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
    this.startOffset = offset;
    this.sourceNode.start(0, offset);
  }

  stop() {
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
      } catch {}
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
  }

  updateProcessing(processing: StemProcessing, bypass: boolean) {
    if (bypass || processing.bypass) {
      this.eqNodes.forEach((n) => (n.gain.value = 0));
      this.compressorNode.threshold.value = 0;
      this.compressorNode.ratio.value = 1;
      this.gainNode.gain.value = 1;
      this.panNode.pan.value = 0;
      this.saturationNode.curve = null;
      this.muteGainNode.gain.value = processing.mute ? 0 : 1;
      return;
    }

    processing.eq.forEach((band, i) => {
      if (this.eqNodes[i]) {
        this.eqNodes[i].type = band.type;
        this.eqNodes[i].frequency.value = band.frequency;
        this.eqNodes[i].gain.value = band.gain;
        this.eqNodes[i].Q.value = band.Q;
      }
    });

    this.applyCompressor(processing.compressor);
    this.applySaturation(processing.saturation);

    this.gainNode.gain.value = Math.pow(10, processing.gain / 20);
    this.panNode.pan.value = processing.pan;
    this.muteGainNode.gain.value = processing.mute ? 0 : 1;
  }

  private applyCompressor(settings: CompressorSettings) {
    this.compressorNode.threshold.value = settings.threshold;
    this.compressorNode.ratio.value = settings.ratio;
    this.compressorNode.attack.value = settings.attack;
    this.compressorNode.release.value = settings.release;
    this.compressorNode.knee.value = settings.knee;
  }

  private applySaturation(settings: SaturationSettings) {
    if (settings.drive <= 0) {
      this.saturationNode.curve = null;
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
    this.saturationNode.curve = curve;
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
    this.eqNodes.forEach((n) => n.disconnect());
    this.compressorNode.disconnect();
    this.saturationNode.disconnect();
    this.gainNode.disconnect();
    this.panNode.disconnect();
    this.analyserNode.disconnect();
    this.muteGainNode.disconnect();
    this.output.disconnect();
  }
}

export class MasterChannel {
  private context: AudioContext;
  private eqNodes: BiquadFilterNode[] = [];
  private compressorNode: DynamicsCompressorNode;
  private limiterNode: DynamicsCompressorNode;
  private saturationNode: WaveShaperNode;
  private stereoWidthNode: ChannelSplitterNode;
  private stereoMerger: ChannelMergerNode;
  private midGain: GainNode;
  private sideGain: GainNode;
  private gainNode: GainNode;
  private analyserL: AnalyserNode;
  private analyserR: AnalyserNode;
  private splitter: ChannelSplitterNode;
  public input: GainNode;
  public output: GainNode;

  constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();

    this.compressorNode = context.createDynamicsCompressor();
    this.limiterNode = context.createDynamicsCompressor();
    this.limiterNode.ratio.value = 20;
    this.limiterNode.knee.value = 0;
    this.limiterNode.attack.value = 0.001;

    this.saturationNode = context.createWaveShaper();
    this.saturationNode.oversample = '4x';

    this.gainNode = context.createGain();

    this.stereoWidthNode = context.createChannelSplitter(2);
    this.stereoMerger = context.createChannelMerger(2);
    this.midGain = context.createGain();
    this.sideGain = context.createGain();

    this.analyserL = context.createAnalyser();
    this.analyserL.fftSize = 2048;
    this.analyserR = context.createAnalyser();
    this.analyserR.fftSize = 2048;
    this.splitter = context.createChannelSplitter(2);

    this.initEQ();
    this.connectChain();
  }

  private initEQ() {
    const bands: { frequency: number; type: BiquadFilterType }[] = [
      { frequency: 80, type: 'lowshelf' },
      { frequency: 1000, type: 'peaking' },
      { frequency: 8000, type: 'highshelf' },
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

  private connectChain() {
    this.input.connect(this.eqNodes[0]);
    for (let i = 1; i < this.eqNodes.length; i++) {
      this.eqNodes[i - 1].connect(this.eqNodes[i]);
    }
    const lastEQ = this.eqNodes[this.eqNodes.length - 1];

    lastEQ.connect(this.compressorNode);
    this.compressorNode.connect(this.saturationNode);
    this.saturationNode.connect(this.limiterNode);
    this.limiterNode.connect(this.gainNode);
    this.gainNode.connect(this.splitter);

    this.splitter.connect(this.analyserL, 0);
    this.splitter.connect(this.analyserR, 1);
    this.gainNode.connect(this.output);
  }

  updateProcessing(processing: MasterProcessing, bypass: boolean) {
    if (bypass || processing.bypass) {
      this.eqNodes.forEach((n) => (n.gain.value = 0));
      this.compressorNode.threshold.value = 0;
      this.compressorNode.ratio.value = 1;
      this.limiterNode.threshold.value = 0;
      this.saturationNode.curve = null;
      this.gainNode.gain.value = 1;
      return;
    }

    processing.eq.forEach((band, i) => {
      if (this.eqNodes[i]) {
        this.eqNodes[i].type = band.type;
        this.eqNodes[i].frequency.value = band.frequency;
        this.eqNodes[i].gain.value = band.gain;
        this.eqNodes[i].Q.value = band.Q;
      }
    });

    this.compressorNode.threshold.value = processing.compressor.threshold;
    this.compressorNode.ratio.value = processing.compressor.ratio;
    this.compressorNode.attack.value = processing.compressor.attack;
    this.compressorNode.release.value = processing.compressor.release;
    this.compressorNode.knee.value = processing.compressor.knee;

    this.limiterNode.threshold.value = processing.limiter.threshold;
    this.limiterNode.release.value = processing.limiter.release;

    this.applySaturation(processing.saturation);
    this.gainNode.gain.value = Math.pow(10, processing.gain / 20);
  }

  private applySaturation(settings: SaturationSettings) {
    if (settings.drive <= 0) {
      this.saturationNode.curve = null;
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
    this.saturationNode.curve = curve;
  }

  getMeterData(): MeterData {
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
    const lufs = rmsAvg > 0 ? 20 * Math.log10(rmsAvg) - 0.691 : -Infinity;

    return {
      peakL: peakL > 0 ? 20 * Math.log10(peakL) : -Infinity,
      peakR: peakR > 0 ? 20 * Math.log10(peakR) : -Infinity,
      rmsL: rmsL > 0 ? 20 * Math.log10(rmsL) : -Infinity,
      rmsR: rmsR > 0 ? 20 * Math.log10(rmsR) : -Infinity,
      lufs,
      clipCount,
    };
  }

  getSpectrumData(): Float32Array {
    const data = new Float32Array(this.analyserL.frequencyBinCount);
    this.analyserL.getFloatFrequencyData(data);
    return data;
  }

  destroy() {
    this.eqNodes.forEach((n) => n.disconnect());
    this.compressorNode.disconnect();
    this.limiterNode.disconnect();
    this.saturationNode.disconnect();
    this.gainNode.disconnect();
    this.splitter.disconnect();
    this.analyserL.disconnect();
    this.analyserR.disconnect();
    this.input.disconnect();
    this.output.disconnect();
  }
}

export class AudioEngine {
  public context: AudioContext;
  public stemChannels: Map<string, StemChannel> = new Map();
  public masterChannel: MasterChannel;
  private isPlaying = false;
  private startTime = 0;
  private pauseOffset = 0;

  constructor() {
    this.context = new AudioContext();
    this.masterChannel = new MasterChannel(this.context);
    this.masterChannel.output.connect(this.context.destination);
  }

  async resume() {
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  addStem(id: string, buffer: AudioBuffer): StemChannel {
    const channel = new StemChannel(this.context);
    channel.setBuffer(buffer);
    channel.output.connect(this.masterChannel.input);
    this.stemChannels.set(id, channel);
    return channel;
  }

  removeStem(id: string) {
    const channel = this.stemChannels.get(id);
    if (channel) {
      channel.destroy();
      this.stemChannels.delete(id);
    }
  }

  play(offset?: number) {
    this.resume();
    const playOffset = offset ?? this.pauseOffset;
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
    if (this.isPlaying) {
      return this.context.currentTime - this.startTime;
    }
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

  async exportWAV(
    stems: Stem[],
    masterProcessing: MasterProcessing,
    duration: number,
    onProgress?: (progress: number) => void
  ): Promise<Blob> {
    const sampleRate = 44100;
    const offlineCtx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const masterChannel = new MasterChannel(offlineCtx as unknown as AudioContext);
    masterChannel.output.connect(offlineCtx.destination);
    masterChannel.updateProcessing(masterProcessing, false);

    stems.forEach((stem, index) => {
      if (!stem.audioBuffer || stem.processing.mute) return;
      const channel = new StemChannel(offlineCtx as unknown as AudioContext);
      channel.setBuffer(stem.audioBuffer);
      channel.output.connect(masterChannel.input);
      channel.updateProcessing(stem.processing, false);
      channel.play(0);

      if (onProgress) {
        onProgress(((index + 1) / stems.length) * 30);
      }
    });

    if (onProgress) onProgress(30);

    const renderedBuffer = await offlineCtx.startRendering();
    if (onProgress) onProgress(80);

    const wav = this.bufferToWAV(renderedBuffer);
    if (onProgress) onProgress(100);

    return new Blob([wav], { type: 'audio/wav' });
  }

  private bufferToWAV(buffer: AudioBuffer): ArrayBuffer {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataLength = buffer.length * blockAlign;
    const headerLength = 44;
    const totalLength = headerLength + dataLength;

    const arrayBuffer = new ArrayBuffer(totalLength);
    const view = new DataView(arrayBuffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, totalLength - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);

    const channels: Float32Array[] = [];
    for (let i = 0; i < numChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        let sample = channels[ch][i];
        sample = Math.max(-1, Math.min(1, sample));
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }

    return arrayBuffer;
  }

  destroy() {
    this.stemChannels.forEach((ch) => ch.destroy());
    this.stemChannels.clear();
    this.masterChannel.destroy();
    this.context.close();
  }
}
