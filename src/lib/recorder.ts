/** Mic capture into AudioBuffer for overdub. */

export interface RecorderState {
  isRecording: boolean;
  isArmed: boolean;
  inputPeak: number;
  elapsedSec: number;
}

export class MicRecorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private startedAt = 0;
  private sampleRate = 44100;
  public inputPeak = 0;
  public isRecording = false;

  async arm(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.context = new AudioContext();
    this.sampleRate = this.context.sampleRate;
    this.source = this.context.createMediaStreamSource(this.stream);
    // Monitor meter without feedback to speakers
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 1024;
    this.source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (!this.stream) return;
      analyser.getFloatTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const a = Math.abs(data[i]);
        if (a > peak) peak = a;
      }
      this.inputPeak = peak;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  start(): void {
    if (!this.context || !this.source) throw new Error('Recorder not armed');
    this.chunks = [];
    this.isRecording = true;
    this.startedAt = this.context.currentTime;
    // ScriptProcessor is deprecated but widely available without worklet registration
    const proc = this.context.createScriptProcessor(4096, 1, 1);
    this.processor = proc;
    this.source.connect(proc);
    const silent = this.context.createGain();
    silent.gain.value = 0;
    proc.connect(silent);
    silent.connect(this.context.destination);
    proc.onaudioprocess = (e) => {
      if (!this.isRecording) return;
      const input = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(input));
      let peak = 0;
      for (let i = 0; i < input.length; i++) {
        const a = Math.abs(input[i]);
        if (a > peak) peak = a;
      }
      this.inputPeak = peak;
    };
  }

  stop(): AudioBuffer {
    this.isRecording = false;
    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch {
        /* */
      }
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    let total = 0;
    for (const c of this.chunks) total += c.length;
    if (total === 0) {
      total = this.sampleRate; // 1s silence fallback
      this.chunks = [new Float32Array(total)];
    }
    const mono = new Float32Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      mono.set(c, offset);
      offset += c.length;
    }
    const ctx = new OfflineAudioContext(1, mono.length, this.sampleRate);
    const buf = ctx.createBuffer(1, mono.length, this.sampleRate);
    buf.copyToChannel(mono, 0);
    this.chunks = [];
    return buf;
  }

  getElapsed(): number {
    if (!this.context || !this.isRecording) return 0;
    return this.context.currentTime - this.startedAt;
  }

  disarm(): void {
    this.isRecording = false;
    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch {
        /* */
      }
      this.processor = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* */
      }
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.context) {
      void this.context.close();
      this.context = null;
    }
    this.inputPeak = 0;
  }
}

/** Simple metronome click buffer. */
export function createClickBuffer(ctx: AudioContext, freq = 1000): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 0.03);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.exp(-t * 80);
    d[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.4;
  }
  return buf;
}
