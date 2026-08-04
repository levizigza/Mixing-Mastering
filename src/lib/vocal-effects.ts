// ─── Vocal & Sound Effects Enhancement ──────────────────────────
// Pure DSP effects chain: de-esser, reverb, delay, chorus, exciter.
// Open source, fully client-side, no external dependencies.

export interface VocalEffectsSettings {
  deEsser: number;        // 0–100: sibilance reduction
  reverb: number;         // 0–100: reverb send amount
  reverbSize: number;     // 0–100: room size (small → large)
  reverbDamping: number;  // 0–100: high-frequency damping
  delay: number;          // 0–100: delay send amount
  delayTime: number;      // in ms (50–500)
  delayFeedback: number;  // 0–100: feedback amount
  chorus: number;         // 0–100: chorus depth
  exciter: number;        // 0–100: harmonic exciter (adds presence)
  warmth: number;         // 0–100: analog-style warmth (gentle saturation)
}

export const defaultVocalEffects: VocalEffectsSettings = {
  deEsser: 30,
  reverb: 5,
  reverbSize: 20,
  reverbDamping: 70,
  delay: 3,
  delayTime: 140,
  delayFeedback: 10,
  chorus: 0,
  exciter: 0,
  warmth: 0,
};

// ─── De-Esser ────────────────────────────────────────────────────
// Detects sibilance (5–9 kHz) and applies dynamic gain reduction

function applyDeEsser(data: Float32Array, sampleRate: number, amount: number): Float32Array {
  if (amount <= 0) return data;
  const output = new Float32Array(data.length);
  const threshold = 0.15 * (1 - amount * 0.7);

  // Smoothed envelope follower for sibilance detection
  const attackCoeff = 1 - Math.exp(-1 / (sampleRate * 0.002));
  const releaseCoeff = 1 - Math.exp(-1 / (sampleRate * 0.02));
  const gainSmooth = 1 - Math.exp(-1 / (sampleRate * 0.004)); // 4ms gain smoothing

  let bandEnv = 0;
  let prevSample = 0;
  let smoothedGain = 1;

  for (let i = 0; i < data.length; i++) {
    const highContent = Math.abs(data[i] - prevSample);
    prevSample = data[i];

    bandEnv += (highContent > bandEnv ? attackCoeff : releaseCoeff) * (highContent - bandEnv);

    let targetGain = 1;
    if (bandEnv > threshold) {
      const overDb = 20 * Math.log10(bandEnv / threshold);
      const reduction = Math.min(overDb * amount * 0.35, 8); // Max 8dB reduction
      targetGain = Math.pow(10, -reduction / 20);
      targetGain = Math.max(0.4, targetGain);
    }

    // Smooth gain transitions to prevent clicks
    smoothedGain += gainSmooth * (targetGain - smoothedGain);
    output[i] = data[i] * smoothedGain;
  }

  return output;
}

// ─── Algorithmic Reverb (Schroeder/Moorer style) ─────────────────

class CombFilter {
  private buffer: Float32Array;
  private index: number = 0;
  private feedback: number;
  private damp: number;
  private prevOutput: number = 0;

  constructor(delaySamples: number, feedback: number, damp: number) {
    this.buffer = new Float32Array(delaySamples);
    this.feedback = feedback;
    this.damp = damp;
  }

  process(input: number): number {
    const output = this.buffer[this.index];
    // Low-pass filter in feedback loop (damping)
    this.prevOutput = output * (1 - this.damp) + this.prevOutput * this.damp;
    this.buffer[this.index] = input + this.prevOutput * this.feedback;
    this.index = (this.index + 1) % this.buffer.length;
    return output;
  }
}

class AllpassFilter {
  private buffer: Float32Array;
  private index: number = 0;
  private feedback: number;

  constructor(delaySamples: number, feedback: number) {
    this.buffer = new Float32Array(delaySamples);
    this.feedback = feedback;
  }

  process(input: number): number {
    const buffered = this.buffer[this.index];
    const output = -input + buffered;
    this.buffer[this.index] = input + buffered * this.feedback;
    this.index = (this.index + 1) % this.buffer.length;
    return output;
  }
}

function applyReverb(
  data: Float32Array,
  sampleRate: number,
  amount: number,
  size: number,
  damping: number
): Float32Array {
  if (amount <= 0) return data;
  const output = new Float32Array(data.length);

  // Pre-delay: keeps the initial vocal transient clean and dry.
  // The ear hears the dry vocal first, then the reverb arrives ~20-40ms later.
  const preDelaySamples = Math.floor(sampleRate * (0.02 + size * 0.02)); // 20-40ms
  const preDelayBuf = new Float32Array(preDelaySamples);
  let preDelayIdx = 0;

  const roomScale = 0.22 + size * 0.35;
  const dampVal = 0.4 + damping * 0.45;
  const feedback = 0.45 + roomScale * 0.18;

  const combDelays = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116];
  const combs = combDelays.map((d) => {
    const scaledDelay = Math.floor(d * roomScale * sampleRate / 44100);
    return new CombFilter(scaledDelay, feedback, dampVal);
  });

  const allpassDelays = [556, 441, 341, 225];
  const allpasses = allpassDelays.map((d) => {
    const scaledDelay = Math.floor(d * sampleRate / 44100);
    return new AllpassFilter(scaledDelay, 0.5);
  });

  // HPF state for reverb return — 400 Hz cuts all low-mid mud from the tail
  const hpFreq = 400;
  const w0 = 2 * Math.PI * hpFreq / sampleRate;
  const hpAlpha = Math.sin(w0) / (2 * 0.707);
  let hpX1 = 0, hpX2 = 0, hpY1 = 0, hpY2 = 0;
  const cosW = Math.cos(w0);
  const hpB0 = (1 + cosW) / 2 / (1 + hpAlpha);
  const hpB1 = -(1 + cosW) / (1 + hpAlpha);
  const hpB2 = hpB0;
  const hpA1 = -2 * cosW / (1 + hpAlpha);
  const hpA2 = (1 - hpAlpha) / (1 + hpAlpha);

  for (let i = 0; i < data.length; i++) {
    // Pre-delay: feed reverb a delayed copy of the input
    const preDelayed = preDelayBuf[preDelayIdx];
    preDelayBuf[preDelayIdx] = data[i];
    preDelayIdx = (preDelayIdx + 1) % preDelaySamples;

    let combSum = 0;
    for (const comb of combs) {
      combSum += comb.process(preDelayed);
    }
    combSum /= combs.length;

    let diffused = combSum;
    for (const ap of allpasses) {
      diffused = ap.process(diffused);
    }

    // HPF the reverb return to keep low-mids clean
    const hpIn = diffused;
    const hpOut = hpB0 * hpIn + hpB1 * hpX1 + hpB2 * hpX2 - hpA1 * hpY1 - hpA2 * hpY2;
    hpX2 = hpX1; hpX1 = hpIn;
    hpY2 = hpY1; hpY1 = hpOut;

    output[i] = data[i] * (1 - amount * 0.06) + hpOut * amount * 0.22;
  }

  return output;
}

// ─── Stereo Delay ────────────────────────────────────────────────

function applyDelay(
  data: Float32Array,
  sampleRate: number,
  amount: number,
  timeMs: number,
  feedback: number
): Float32Array {
  if (amount <= 0) return data;
  const output = new Float32Array(data.length);
  const delaySamples = Math.floor(sampleRate * timeMs / 1000);
  const delayBuffer = new Float32Array(delaySamples);
  let writeIdx = 0;

  for (let i = 0; i < data.length; i++) {
    const delayed = delayBuffer[writeIdx];
    output[i] = data[i] + delayed * amount * 0.2;
    delayBuffer[writeIdx] = data[i] * 0.5 + delayed * feedback * 0.45;
    writeIdx = (writeIdx + 1) % delaySamples;
  }

  return output;
}

// ─── Chorus ──────────────────────────────────────────────────────
// LFO-modulated delay for thickening

function applyChorus(
  data: Float32Array,
  sampleRate: number,
  depth: number
): Float32Array {
  if (depth <= 0) return data;
  const output = new Float32Array(data.length);
  const maxDelay = Math.floor(sampleRate * 0.02); // 20ms max modulation
  const bufLen = maxDelay * 4; // Extra buffer space to avoid boundary issues
  const buffer = new Float32Array(bufLen);
  let writeIdx = 0;
  const rate = 0.8; // Slower LFO rate for smoother modulation

  for (let i = 0; i < data.length; i++) {
    buffer[writeIdx] = data[i];

    // Smooth LFO (sine)
    const lfo = Math.sin(2 * Math.PI * rate * i / sampleRate);
    const modDelay = maxDelay * (0.5 + lfo * 0.3 * depth); // Reduced modulation depth
    const readPos = writeIdx - modDelay;
    const readPosWrapped = ((readPos % bufLen) + bufLen) % bufLen;

    const idx0 = Math.floor(readPosWrapped);
    const frac = readPosWrapped - idx0;
    const idx1 = (idx0 + 1) % bufLen;

    const delayed = buffer[idx0] * (1 - frac) + buffer[idx1] * frac;

    // Minimal chorus — keeps vocal tight and centered behind the beat
    output[i] = data[i] * (1 - depth * 0.1) + delayed * depth * 0.15;
    writeIdx = (writeIdx + 1) % bufLen;
  }

  return output;
}

// ─── Harmonic Exciter ────────────────────────────────────────────
// Generates harmonics via soft clipping on filtered high-frequency content

function applyExciter(
  data: Float32Array,
  sampleRate: number,
  amount: number
): Float32Array {
  if (amount <= 0) return data;
  const output = new Float32Array(data.length);

  // Simple high-pass to isolate content above 3 kHz
  let prevHp = 0;
  const hpCoeff = 1 - Math.exp(-2 * Math.PI * 3000 / sampleRate);

  for (let i = 0; i < data.length; i++) {
    const hp = prevHp + hpCoeff * (data[i] - prevHp);
    const highContent = data[i] - hp;
    prevHp = hp;

    // Generate harmonics via tanh saturation
    const harmonics = Math.tanh(highContent * (2 + amount * 4)) * 0.5;

    // Mix harmonics back in
    output[i] = data[i] + harmonics * amount * 0.4;
  }

  return output;
}

// ─── Analog Warmth (Tape Saturation) ─────────────────────────────

function applyWarmth(data: Float32Array, amount: number): Float32Array {
  if (amount <= 0) return data;
  const output = new Float32Array(data.length);
  const drive = 1 + amount * 2;

  for (let i = 0; i < data.length; i++) {
    const driven = data[i] * drive;
    // Soft saturation curve (tape-style)
    output[i] = (Math.tanh(driven) / Math.tanh(drive)) * (1 - amount * 0.1) + data[i] * amount * 0.1;
  }

  return output;
}

// ─── Vocal Auto-Leveler (Rider) ──────────────────────────────────
// Smooths out volume inconsistencies before any effects processing.
// Uses a slow envelope follower with target-gain smoothing to gently
// ride the vocal level up in quiet phrases and down in loud ones.

function applyVocalRider(data: Float32Array, sampleRate: number): Float32Array {
  const output = new Float32Array(data.length);
  const blockSize = Math.floor(sampleRate * 0.08); // 80ms blocks — smoother
  const targetRms = 0.08; // ~-22 dBFS — conservative, let later stages handle gain
  const maxBoost = 1.8;   // +5 dB max lift
  const maxCut = 0.6;     // -4 dB max reduction
  const noiseFloor = 0.008; // gate: don't touch anything below this RMS

  const numBlocks = Math.ceil(data.length / blockSize);
  const blockGains = new Float32Array(numBlocks);

  for (let b = 0; b < numBlocks; b++) {
    const start = b * blockSize;
    const end = Math.min(start + blockSize, data.length);
    let rms = 0;
    for (let i = start; i < end; i++) rms += data[i] * data[i];
    rms = Math.sqrt(rms / (end - start));

    if (rms < noiseFloor) {
      blockGains[b] = 1; // below noise floor — pass through, don't boost
    } else {
      blockGains[b] = Math.max(maxCut, Math.min(maxBoost, targetRms / rms));
    }
  }

  const smoothCoeff = 1 - Math.exp(-1 / (sampleRate * 0.05)); // 50ms smoothing — slower
  let smoothGain = 1;
  for (let i = 0; i < data.length; i++) {
    const blockIdx = Math.min(Math.floor(i / blockSize), numBlocks - 1);
    smoothGain += smoothCoeff * (blockGains[blockIdx] - smoothGain);
    output[i] = data[i] * smoothGain;
  }

  return output;
}

// ─── Main Effects Chain ──────────────────────────────────────────

export async function applyVocalEffects(
  buffer: AudioBuffer,
  settings: VocalEffectsSettings,
  onProgress?: (progress: number, message: string) => void
): Promise<AudioBuffer> {
  const sr = buffer.sampleRate;
  const numCh = buffer.numberOfChannels;
  const len = buffer.length;

  const channels: Float32Array[] = [];

  for (let ch = 0; ch < numCh; ch++) {
    let data: Float32Array = new Float32Array(buffer.getChannelData(ch));

    // Minimal vocal chain: de-esser only. Reverb and delay only if requested.
    // Every unnecessary effect degrades the signal — keep it clean.

    onProgress?.(10 + (ch / numCh) * 25, 'De-essing...');
    await new Promise((r) => setTimeout(r, 0));
    data = applyDeEsser(data, sr, settings.deEsser / 100);

    if (settings.reverb > 0) {
      onProgress?.(35 + (ch / numCh) * 25, 'Applying reverb...');
      await new Promise((r) => setTimeout(r, 0));
      data = applyReverb(data, sr, settings.reverb / 100, settings.reverbSize / 100, settings.reverbDamping / 100);
    }

    if (settings.delay > 0) {
      onProgress?.(60 + (ch / numCh) * 20, 'Adding delay...');
      await new Promise((r) => setTimeout(r, 0));
      data = applyDelay(data, sr, settings.delay / 100, settings.delayTime, settings.delayFeedback / 100);
    }

    channels.push(data);
  }

  onProgress?.(90, 'Smoothing output...');
  await new Promise((r) => setTimeout(r, 0));

  // Final safety: smooth limiter to catch any remaining clicks
  for (let ch = 0; ch < channels.length; ch++) {
    const data = channels[ch];
    const ceiling = 0.95;
    let smoothGain = 1;
    const gainRelease = 1 - Math.exp(-1 / (sr * 0.005)); // 5ms release

    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      let targetGain = 1;
      if (abs > ceiling) {
        targetGain = ceiling / abs;
      }
      if (targetGain < smoothGain) {
        smoothGain = targetGain; // Instant attack
      } else {
        smoothGain += gainRelease * (targetGain - smoothGain);
      }
      data[i] *= smoothGain;
    }
  }

  onProgress?.(95, 'Finalizing effects...');

  const ctx = new OfflineAudioContext(numCh, len, sr);
  const outputBuffer = ctx.createBuffer(numCh, len, sr);
  for (let ch = 0; ch < numCh; ch++) {
    outputBuffer.copyToChannel(new Float32Array(channels[ch]), ch);
  }

  onProgress?.(100, 'Effects complete!');
  return outputBuffer;
}

// ─── Auto-detect appropriate effect settings ─────────────────────
// Analyzes audio characteristics and returns tailored effect settings

export function autoDetectEffectSettings(buffer: AudioBuffer): VocalEffectsSettings {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const len = Math.min(data.length, sr * 10);

  // Measure sibilance level
  let highEnergyCount = 0;
  let prevSample = 0;
  let totalEnergy = 0;
  for (let i = 0; i < len; i++) {
    const highContent = Math.abs(data[i] - prevSample);
    if (highContent > 0.1) highEnergyCount++;
    totalEnergy += data[i] * data[i];
    prevSample = data[i];
  }
  const sibilanceRatio = highEnergyCount / len;
  const rms = Math.sqrt(totalEnergy / len);

  // Measure dynamic range for reverb decisions
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
  }
  const crest = peak > 0 && rms > 0 ? 20 * Math.log10(peak / rms) : 12;

  // Louder/denser material → less reverb, more exciter
  // Softer/dynamic material → more reverb, less exciter
  const isLoud = rms > 0.15;
  const isDynamic = crest > 14;
  const hasSibilance = sibilanceRatio > 0.05;

  return {
    deEsser: hasSibilance ? 50 : 30,
    reverb: isDynamic ? 10 : isLoud ? 6 : 8,
    reverbSize: isDynamic ? 30 : 22,
    reverbDamping: 65,
    delay: isDynamic ? 6 : 3,
    delayTime: 140,
    delayFeedback: 12,
    chorus: 0,
    exciter: isLoud ? 15 : 10,
    warmth: isLoud ? 12 : 18,
  };
}
