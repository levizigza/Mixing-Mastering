// ─── Cinematic Enhancement Module ────────────────────────────────
// Makes any track sound more cinematic regardless of genre.
// Adds depth, width, emotional weight, and dramatic impact:
//   1. Sub-harmonic generation (power and weight)
//   2. Cinematic reverb (deep, lush plate/hall tail)
//   3. Stereo widening with depth perception
//   4. Dynamic expansion (quiet → quieter, loud → louder)
//   5. Mid-range sweetness / vocal presence
//   6. High-frequency shimmer / air
//   7. Low-mid warmth for emotional body
//
// Fully open source. No external dependencies.

export interface CinematicSettings {
  depth: number;         // 0–100: reverb depth / spaciousness
  width: number;        // 0–100: stereo width enhancement
  impact: number;       // 0–100: sub-harmonic generation
  dynamics: number;     // 0–100: dynamic expansion
  warmth: number;       // 0–100: low-mid body
  shimmer: number;      // 0–100: high-freq sparkle
  presence: number;     // 0–100: mid-range clarity
}

export const defaultCinematicSettings: CinematicSettings = {
  depth: 20,
  width: 25,
  impact: 15,
  dynamics: 20,
  warmth: 15,
  shimmer: 20,
  presence: 25,
};

// ─── Sub-Harmonic Generator ──────────────────────────────────────
// Generates an octave-below sub-bass from the low frequencies for weight.

function generateSubHarmonics(
  data: Float32Array,
  sampleRate: number,
  amount: number
): Float32Array {
  if (amount <= 0) return data;
  const output = new Float32Array(data.length);

  // Extract low frequencies (< 100 Hz) with a smooth low-pass
  const lpCoeff = 1 - Math.exp(-2 * Math.PI * 100 / sampleRate);
  let lp1 = 0, lp2 = 0;
  const lowContent = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    lp1 += lpCoeff * (data[i] - lp1);
    lp2 += lpCoeff * (lp1 - lp2);
    lowContent[i] = lp2;
  }

  // Generate sub-harmonic via frequency halving (full-wave rectification + filter)
  const subContent = new Float32Array(data.length);
  let subLp1 = 0, subLp2 = 0;
  const subLpCoeff = 1 - Math.exp(-2 * Math.PI * 60 / sampleRate);

  for (let i = 0; i < data.length; i++) {
    // Soft rectification for octave-down generation
    const rectified = Math.tanh(lowContent[i] * 3) * 0.5;
    // Low-pass the sub to keep it clean
    subLp1 += subLpCoeff * (rectified - subLp1);
    subLp2 += subLpCoeff * (subLp1 - subLp2);
    subContent[i] = subLp2;
  }

  // Mix: original + very subtle sub-harmonic
  const subMix = amount * 0.12;
  for (let i = 0; i < data.length; i++) {
    output[i] = data[i] + subContent[i] * subMix;
  }

  return output;
}

// ─── Cinematic Reverb (Plate / Hall Hybrid) ──────────────────────
// Long, lush reverb tail with high density and pre-delay for depth.

class CinematicComb {
  private buffer: Float32Array;
  private index: number = 0;
  private feedback: number;
  private damp: number;
  private prevOut: number = 0;

  constructor(delaySamples: number, feedback: number, damp: number) {
    this.buffer = new Float32Array(Math.max(1, delaySamples));
    this.feedback = feedback;
    this.damp = damp;
  }

  process(input: number): number {
    const out = this.buffer[this.index];
    this.prevOut = out * (1 - this.damp) + this.prevOut * this.damp;
    this.buffer[this.index] = input + this.prevOut * this.feedback;
    this.index = (this.index + 1) % this.buffer.length;
    return out;
  }
}

class CinematicAllpass {
  private buffer: Float32Array;
  private index: number = 0;
  private gain: number;

  constructor(delaySamples: number, gain: number) {
    this.buffer = new Float32Array(Math.max(1, delaySamples));
    this.gain = gain;
  }

  process(input: number): number {
    const buffered = this.buffer[this.index];
    const output = -input + buffered;
    this.buffer[this.index] = input + buffered * this.gain;
    this.index = (this.index + 1) % this.buffer.length;
    return output;
  }
}

function applyCinematicReverb(
  data: Float32Array,
  sampleRate: number,
  amount: number
): Float32Array {
  if (amount <= 0) return data;
  const output = new Float32Array(data.length);

  // Long decay, high density for cinematic feel
  const decay = 0.82 + amount * 0.12; // 0.82–0.94 feedback
  const damp = 0.3; // Less damping = brighter, more shimmer

  // 8 comb filters (plate-style spacing)
  const combDelays = [2141, 2311, 2473, 2621, 2791, 2953, 3137, 3299];
  const combs = combDelays.map(d => {
    const scaled = Math.floor(d * sampleRate / 44100);
    return new CinematicComb(scaled, decay, damp);
  });

  // 4 allpass diffusers
  const allpassDelays = [617, 535, 443, 331];
  const allpasses = allpassDelays.map(d => {
    const scaled = Math.floor(d * sampleRate / 44100);
    return new CinematicAllpass(scaled, 0.6);
  });

  // Pre-delay (40ms) for depth perception
  const preDelaySamples = Math.floor(sampleRate * 0.04);
  const preDelayBuf = new Float32Array(preDelaySamples);
  let preDelayIdx = 0;

  for (let i = 0; i < data.length; i++) {
    // Pre-delay
    const preDelayed = preDelayBuf[preDelayIdx];
    preDelayBuf[preDelayIdx] = data[i];
    preDelayIdx = (preDelayIdx + 1) % preDelaySamples;

    // Sum all comb filter outputs
    let combSum = 0;
    for (const comb of combs) {
      combSum += comb.process(preDelayed);
    }
    combSum /= combs.length;

    // Diffuse through allpass chain
    let diffused = combSum;
    for (const ap of allpasses) {
      diffused = ap.process(diffused);
    }

    // Wet/dry mix — very subtle, just adds sense of space
    const wet = amount * 0.15;
    output[i] = data[i] * (1 - wet * 0.15) + diffused * wet;
  }

  return output;
}

// ─── Stereo Width with Depth ─────────────────────────────────────
// Creates a wider stereo image and adds a sense of front-to-back depth.

function applyStereoWidthAndDepth(
  L: Float32Array,
  R: Float32Array,
  sampleRate: number,
  amount: number
): { L: Float32Array; R: Float32Array } {
  if (amount <= 0) return { L, R };
  const len = L.length;
  const outL = new Float32Array(len);
  const outR = new Float32Array(len);

  // Mid/Side processing for width — subtle
  const widthGain = 1.0 + amount * 0.2;

  // Haas effect: tiny delay on one side for depth (0.3–0.8ms)
  const haasDelay = Math.floor(sampleRate * (0.0003 + amount * 0.0005));
  const haasBuffer = new Float32Array(haasDelay);
  let haasIdx = 0;

  for (let i = 0; i < len; i++) {
    const mid = (L[i] + R[i]) * 0.5;
    const side = (L[i] - R[i]) * 0.5;

    // Widen the side signal
    const wideSide = side * widthGain;

    // Haas: apply micro-delay to right channel for depth
    const haasOut = haasBuffer[haasIdx];
    haasBuffer[haasIdx] = R[i];
    haasIdx = (haasIdx + 1) % haasDelay;

    const haasBlend = amount * 0.1;
    outL[i] = mid + wideSide;
    outR[i] = (mid - wideSide) * (1 - haasBlend) + haasOut * haasBlend + (mid - wideSide) * haasBlend;
  }

  return { L: outL, R: outR };
}

// ─── Dynamic Expansion ───────────────────────────────────────────
// Makes quiet parts quieter and loud parts a touch louder — creates
// dramatic contrast that makes music feel more cinematic/emotional.

function applyDynamicExpansion(
  data: Float32Array,
  sampleRate: number,
  amount: number
): Float32Array {
  if (amount <= 0) return data;
  const output = new Float32Array(data.length);

  // Gentle expander: reduce gain below threshold
  const attackCoeff = 1 - Math.exp(-1 / (sampleRate * 0.015));
  const releaseCoeff = 1 - Math.exp(-1 / (sampleRate * 0.2));
  const gainSmooth = 1 - Math.exp(-1 / (sampleRate * 0.01));
  const threshold = 0.08 + (1 - amount) * 0.1; // Adaptive threshold
  const ratio = 1.5 + amount * 1.0; // Expansion ratio (1.5:1 to 2.5:1)

  let env = 0;
  let smoothedGain = 1;

  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    env += (abs > env ? attackCoeff : releaseCoeff) * (abs - env);

    let targetGain = 1;
    if (env < threshold && env > 0.001) {
      // Below threshold: reduce gain (expansion)
      const belowDb = 20 * Math.log10(threshold / Math.max(env, 0.0001));
      const expansion = belowDb * (1 - 1 / ratio) * amount * 0.5;
      targetGain = Math.max(0.15, Math.pow(10, -expansion / 20));
    }

    smoothedGain += gainSmooth * (targetGain - smoothedGain);
    output[i] = data[i] * smoothedGain;
  }

  return output;
}

// ─── Mid-Range Sweetness ─────────────────────────────────────────
// Gentle peaking EQ around 1–3 kHz that adds vocal clarity and emotion.

function applyMidPresence(
  data: Float32Array,
  sampleRate: number,
  amount: number
): Float32Array {
  if (amount <= 0) return data;
  const output = new Float32Array(data.length);

  // Two subtle peaks: 1.5 kHz (body) and 4 kHz (presence)
  const freq1 = 1500;
  const freq2 = 4000;
  const gain1 = amount * 1.0; // Up to +1 dB
  const gain2 = amount * 0.8; // Up to +0.8 dB

  // Biquad peaking filter 1
  const w1 = 2 * Math.PI * freq1 / sampleRate;
  const A1 = Math.pow(10, gain1 / 40);
  const alpha1 = Math.sin(w1) / (2 * 1.5);
  const b0_1 = (1 + alpha1 * A1) / (1 + alpha1 / A1);
  const b1_1 = (-2 * Math.cos(w1)) / (1 + alpha1 / A1);
  const b2_1 = (1 - alpha1 * A1) / (1 + alpha1 / A1);
  const a1_1 = (-2 * Math.cos(w1)) / (1 + alpha1 / A1);
  const a2_1 = (1 - alpha1 / A1) / (1 + alpha1 / A1);

  let x1_a = 0, x2_a = 0, y1_a = 0, y2_a = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = b0_1 * x + b1_1 * x1_a + b2_1 * x2_a - a1_1 * y1_a - a2_1 * y2_a;
    output[i] = y;
    x2_a = x1_a; x1_a = x;
    y2_a = y1_a; y1_a = y;
  }

  // Biquad peaking filter 2
  const w2 = 2 * Math.PI * freq2 / sampleRate;
  const A2 = Math.pow(10, gain2 / 40);
  const alpha2 = Math.sin(w2) / (2 * 1.8);
  const b0_2 = (1 + alpha2 * A2) / (1 + alpha2 / A2);
  const b1_2 = (-2 * Math.cos(w2)) / (1 + alpha2 / A2);
  const b2_2 = (1 - alpha2 * A2) / (1 + alpha2 / A2);
  const a1_2 = (-2 * Math.cos(w2)) / (1 + alpha2 / A2);
  const a2_2 = (1 - alpha2 / A2) / (1 + alpha2 / A2);

  let x1_b = 0, x2_b = 0, y1_b = 0, y2_b = 0;
  for (let i = 0; i < data.length; i++) {
    const x = output[i];
    const y = b0_2 * x + b1_2 * x1_b + b2_2 * x2_b - a1_2 * y1_b - a2_2 * y2_b;
    output[i] = y;
    x2_b = x1_b; x1_b = x;
    y2_b = y1_b; y1_b = y;
  }

  return output;
}

// ─── High-Frequency Shimmer ──────────────────────────────────────
// Adds a beautiful high-frequency sparkle — like sunlight on water.

function applyShimmer(
  data: Float32Array,
  sampleRate: number,
  amount: number
): Float32Array {
  if (amount <= 0) return data;
  const output = new Float32Array(data.length);

  // High shelf boost at 10 kHz — subtle sparkle
  const freq = 10000;
  const gainDb = amount * 1.0;
  const A = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * freq / sampleRate;
  const alpha = Math.sin(w0) / (2 * 0.6);
  const cosW = Math.cos(w0);
  const sqrtA = Math.sqrt(A);

  const b0 = A * ((A + 1) + (A - 1) * cosW + 2 * sqrtA * alpha);
  const b1 = -2 * A * ((A - 1) + (A + 1) * cosW);
  const b2 = A * ((A + 1) + (A - 1) * cosW - 2 * sqrtA * alpha);
  const a0 = (A + 1) - (A - 1) * cosW + 2 * sqrtA * alpha;
  const a1 = 2 * ((A - 1) - (A + 1) * cosW);
  const a2 = (A + 1) - (A - 1) * cosW - 2 * sqrtA * alpha;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2
            - (a1 / a0) * y1 - (a2 / a0) * y2;
    output[i] = y;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
  }

  // Add very subtle harmonic shimmer
  let hpPrev = 0;
  const hpCoeff = 1 - Math.exp(-2 * Math.PI * 8000 / sampleRate);
  for (let i = 0; i < data.length; i++) {
    hpPrev += hpCoeff * (output[i] - hpPrev);
    const highContent = output[i] - hpPrev;
    const shimmerHarmonics = Math.tanh(highContent * 1.5) * 0.2;
    output[i] += shimmerHarmonics * amount * 0.05;
  }

  return output;
}

// ─── Low-Mid Warmth ──────────────────────────────────────────────
// Adds body and emotional warmth to the low-mid range.

function applyWarmth(
  data: Float32Array,
  sampleRate: number,
  amount: number
): Float32Array {
  if (amount <= 0) return data;
  const output = new Float32Array(data.length);

  // Low shelf boost at 200 Hz — very gentle
  const freq = 200;
  const gainDb = amount * 0.8;
  const A = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * freq / sampleRate;
  const alpha = Math.sin(w0) / (2 * 0.7);
  const cosW = Math.cos(w0);
  const sqrtA = Math.sqrt(A);

  const b0 = A * ((A + 1) - (A - 1) * cosW + 2 * sqrtA * alpha);
  const b1 = 2 * A * ((A - 1) - (A + 1) * cosW);
  const b2 = A * ((A + 1) - (A - 1) * cosW - 2 * sqrtA * alpha);
  const a0 = (A + 1) + (A - 1) * cosW + 2 * sqrtA * alpha;
  const a1 = -2 * ((A - 1) + (A + 1) * cosW);
  const a2 = (A + 1) + (A - 1) * cosW - 2 * sqrtA * alpha;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2
            - (a1 / a0) * y1 - (a2 / a0) * y2;
    output[i] = y;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
  }

  // Very subtle tape saturation on the low-mids
  for (let i = 0; i < data.length; i++) {
    const saturated = Math.tanh(output[i] * (1.1 + amount * 0.3));
    output[i] = output[i] * (1 - amount * 0.05) + saturated * amount * 0.05;
  }

  return output;
}

// ─── Main Cinematic Enhancement Function ─────────────────────────

export async function applyCinematicEnhancement(
  buffer: AudioBuffer,
  settings: CinematicSettings,
  onProgress?: (progress: number, message: string) => void
): Promise<AudioBuffer> {
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const isStereo = buffer.numberOfChannels >= 2;

  let L: Float32Array = new Float32Array(buffer.getChannelData(0));
  let R: Float32Array = new Float32Array(isStereo ? buffer.getChannelData(1) : buffer.getChannelData(0));

  const depth = settings.depth / 100;
  const width = settings.width / 100;
  const impact = settings.impact / 100;
  const dynamics = settings.dynamics / 100;
  const warmth = settings.warmth / 100;
  const shimmer = settings.shimmer / 100;
  const presence = settings.presence / 100;

  // Stage 1: Sub-harmonic generation (impact/power)
  onProgress?.(5, 'Generating cinematic sub-harmonics...');
  await new Promise((r) => setTimeout(r, 0));
  L = generateSubHarmonics(L, sr, impact);
  R = generateSubHarmonics(R, sr, impact);

  // Stage 2: Low-mid warmth (emotional body)
  onProgress?.(15, 'Adding cinematic warmth...');
  await new Promise((r) => setTimeout(r, 0));
  L = applyWarmth(L, sr, warmth);
  R = applyWarmth(R, sr, warmth);

  // Stage 3: Mid-range presence (clarity/emotion)
  onProgress?.(28, 'Enhancing mid-range presence...');
  await new Promise((r) => setTimeout(r, 0));
  L = applyMidPresence(L, sr, presence);
  R = applyMidPresence(R, sr, presence);

  // Stage 4: Dynamic expansion (dramatic contrast)
  onProgress?.(40, 'Expanding dynamics for cinematic contrast...');
  await new Promise((r) => setTimeout(r, 0));
  L = applyDynamicExpansion(L, sr, dynamics);
  R = applyDynamicExpansion(R, sr, dynamics);

  // Stage 5: Cinematic reverb (depth/space)
  onProgress?.(55, 'Applying cinematic reverb...');
  await new Promise((r) => setTimeout(r, 0));
  L = applyCinematicReverb(L, sr, depth);
  R = applyCinematicReverb(R, sr, depth);

  // Stage 6: Stereo width and depth
  onProgress?.(70, 'Widening stereo field...');
  await new Promise((r) => setTimeout(r, 0));
  if (isStereo) {
    const widened = applyStereoWidthAndDepth(L, R, sr, width);
    L = widened.L;
    R = widened.R;
  }

  // Stage 7: High-frequency shimmer
  onProgress?.(82, 'Adding high-frequency shimmer...');
  await new Promise((r) => setTimeout(r, 0));
  L = applyShimmer(L, sr, shimmer);
  R = applyShimmer(R, sr, shimmer);

  // Stage 8: Final soft limiter to prevent clipping
  onProgress?.(92, 'Final cinematic polish...');
  await new Promise((r) => setTimeout(r, 0));
  const ceiling = 0.95;
  let limiterGain = 1;
  const limiterRelease = 1 - Math.exp(-1 / (sr * 0.008));

  for (let i = 0; i < len; i++) {
    const peak = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    let targetGain = 1;
    if (peak > ceiling) {
      targetGain = ceiling / peak;
    }
    if (targetGain < limiterGain) {
      limiterGain = targetGain;
    } else {
      limiterGain += limiterRelease * (targetGain - limiterGain);
    }
    L[i] *= limiterGain;
    R[i] *= limiterGain;
  }

  // Build output buffer
  const ctx = new OfflineAudioContext(isStereo ? 2 : 1, len, sr);
  const outputBuffer = ctx.createBuffer(isStereo ? 2 : 1, len, sr);
  outputBuffer.copyToChannel(new Float32Array(L), 0);
  if (isStereo) outputBuffer.copyToChannel(new Float32Array(R), 1);

  onProgress?.(100, 'Cinematic enhancement complete!');
  return outputBuffer;
}
