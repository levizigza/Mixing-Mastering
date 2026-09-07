// ─── Industry-Level Mastering Chain ──────────────────────────────
// Full mastering pipeline applied to the final mix bus:
//   1. Pre-EQ (corrective, mid-side capable)
//   2. Multiband compression (4 bands)
//   3. Stereo enhancement (mid-side widening)
//   4. Harmonic exciter (per-band saturation)
//   5. Post-EQ (tonal shaping / air)
//   6. Bus compressor (glue)
//   7. True-peak limiter with lookahead
//   8. Final gain targeting (LUFS)
//
// Fully open source. No external dependencies.

import { MasterProcessing, EQBand } from '@/types/audio';
import { TrackAnalysis } from './auto-mix';

export interface MasteringChainResult {
  buffer: AudioBuffer;
  finalLUFS: number;
  truePeak: number;
}

// ─── Utility ─────────────────────────────────────────────────────

function createBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const ctx = new OfflineAudioContext(channels.length, channels[0].length, sampleRate);
  const buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
  for (let ch = 0; ch < channels.length; ch++) buf.copyToChannel(new Float32Array(channels[ch]), ch);
  return buf;
}

// ─── Biquad Filter Implementation ───────────────────────────────
// Software biquad for sample-accurate processing without OfflineAudioContext overhead

interface BiquadCoeffs { b0: number; b1: number; b2: number; a1: number; a2: number; }

function calcPeakingCoeffs(freq: number, gain: number, Q: number, sr: number): BiquadCoeffs {
  const A = Math.pow(10, gain / 40);
  const w0 = 2 * Math.PI * freq / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const b0 = 1 + alpha * A;
  const b1 = -2 * Math.cos(w0);
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha / A;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function calcLowShelfCoeffs(freq: number, gain: number, Q: number, sr: number): BiquadCoeffs {
  const A = Math.pow(10, gain / 40);
  const w0 = 2 * Math.PI * freq / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const cosW = Math.cos(w0);
  const sqrtA = Math.sqrt(A);
  const b0 = A * ((A + 1) - (A - 1) * cosW + 2 * sqrtA * alpha);
  const b1 = 2 * A * ((A - 1) - (A + 1) * cosW);
  const b2 = A * ((A + 1) - (A - 1) * cosW - 2 * sqrtA * alpha);
  const a0 = (A + 1) + (A - 1) * cosW + 2 * sqrtA * alpha;
  const a1 = -2 * ((A - 1) + (A + 1) * cosW);
  const a2 = (A + 1) + (A - 1) * cosW - 2 * sqrtA * alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function calcHighShelfCoeffs(freq: number, gain: number, Q: number, sr: number): BiquadCoeffs {
  const A = Math.pow(10, gain / 40);
  const w0 = 2 * Math.PI * freq / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const cosW = Math.cos(w0);
  const sqrtA = Math.sqrt(A);
  const b0 = A * ((A + 1) + (A - 1) * cosW + 2 * sqrtA * alpha);
  const b1 = -2 * A * ((A - 1) + (A + 1) * cosW);
  const b2 = A * ((A + 1) + (A - 1) * cosW - 2 * sqrtA * alpha);
  const a0 = (A + 1) - (A - 1) * cosW + 2 * sqrtA * alpha;
  const a1 = 2 * ((A - 1) - (A + 1) * cosW);
  const a2 = (A + 1) - (A - 1) * cosW - 2 * sqrtA * alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function calcHighpassCoeffs(freq: number, Q: number, sr: number): BiquadCoeffs {
  const w0 = 2 * Math.PI * freq / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const cosW = Math.cos(w0);
  const b0 = (1 + cosW) / 2;
  const b1 = -(1 + cosW);
  const b2 = (1 + cosW) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW;
  const a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function calcLowpassCoeffs(freq: number, Q: number, sr: number): BiquadCoeffs {
  const w0 = 2 * Math.PI * freq / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const cosW = Math.cos(w0);
  const b0 = (1 - cosW) / 2;
  const b1 = 1 - cosW;
  const b2 = (1 - cosW) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW;
  const a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function processBiquad(data: Float32Array, coeffs: BiquadCoeffs): Float32Array {
  const output = new Float32Array(data.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = coeffs.b0 * x + coeffs.b1 * x1 + coeffs.b2 * x2 - coeffs.a1 * y1 - coeffs.a2 * y2;
    output[i] = y;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
  }
  return output;
}

// ─── Multiband Splitting ─────────────────────────────────────────
// Industry-standard multiband uses Linkwitz-Riley 4th-order crossovers
// (two cascaded Butterworth 2nd-order). LR4 guarantees flat magnitude
// reconstruction when bands recombine in-phase.
//
// IMPORTANT: for a serial cascade split (split at f1 -> low + rest,
// then split rest at f2, etc.), the lower bands pass through fewer
// filter stages than the upper bands, so their group delay is shorter.
// Without phase compensation the recombined output has dips at every
// crossover. We apply 4th-order all-pass filters (LR4_LP + LR4_HP of
// the same input) on the low and low-mid bands so all four paths have
// matching group delay and reconstruction is flat.

function lr4LP(data: Float32Array, freq: number, sr: number): Float32Array {
  const c = calcLowpassCoeffs(freq, 0.7071, sr);
  return processBiquad(processBiquad(data, c), c);
}
function lr4HP(data: Float32Array, freq: number, sr: number): Float32Array {
  const c = calcHighpassCoeffs(freq, 0.7071, sr);
  return processBiquad(processBiquad(data, c), c);
}
/** 4th-order all-pass: LR4_LP(x) + LR4_HP(x). Flat magnitude,
 *  matches the phase response of an LR4 crossover at `freq`. */
function ap4(data: Float32Array, freq: number, sr: number): Float32Array {
  const lp = lr4LP(data, freq, sr);
  const hp = lr4HP(data, freq, sr);
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = lp[i] + hp[i];
  return out;
}

function splitBands(
  data: Float32Array, sr: number
): { low: Float32Array; lowMid: Float32Array; highMid: Float32Array; high: Float32Array } {
  const F1 = 120;    // sub / low boundary
  const F2 = 1200;   // low / mid boundary
  const F3 = 6000;   // mid / high boundary

  // Split at F1
  let low    = lr4LP(data, F1, sr);
  const res1 = lr4HP(data, F1, sr);
  // Split residual at F2
  let lowMid = lr4LP(res1, F2, sr);
  const res2 = lr4HP(res1, F2, sr);
  // Split residual at F3
  const highMid = lr4LP(res2, F3, sr);
  const high    = lr4HP(res2, F3, sr);

  // Phase compensation so all four bands share the same group delay.
  //   low path went through 1 crossover; high/highMid went through 3.
  //   Add AP(F2) and AP(F3) to low, and AP(F3) to lowMid.
  low    = ap4(low,    F2, sr);
  low    = ap4(low,    F3, sr);
  lowMid = ap4(lowMid, F3, sr);

  return { low, lowMid, highMid, high };
}

// ─── Compressor ──────────────────────────────────────────────────

function compressBand(
  data: Float32Array,
  sr: number,
  threshold: number,
  ratio: number,
  attack: number,
  release: number,
  makeupGain: number
): Float32Array {
  const output = new Float32Array(data.length);
  const attackCoeff = 1 - Math.exp(-1 / (sr * attack));
  const releaseCoeff = 1 - Math.exp(-1 / (sr * release));
  let env = 0;

  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    env += (abs > env ? attackCoeff : releaseCoeff) * (abs - env);

    let gain = 1;
    if (env > 0) {
      const envDb = 20 * Math.log10(env);
      if (envDb > threshold) {
        const overDb = envDb - threshold;
        const compressedOver = overDb / ratio;
        gain = Math.pow(10, (compressedOver - overDb) / 20);
      }
    }

    output[i] = data[i] * gain * Math.pow(10, makeupGain / 20);
  }

  return output;
}

/**
 * Bus compressor with sidechain HPF on the detection signal. Without this
 * the detection is dominated by sub/bass content and the whole mix ducks
 * on every kick — the "pumping" / breathing effect that reads as mud
 * because the upper spectrum periodically collapses with low-freq transients.
 *
 * Key signal is band-split at `scFreq` (default 100 Hz) — low content is
 * removed from detection but NOT from the audio being compressed.
 */
function compressBusSC(
  data: Float32Array,
  sr: number,
  threshold: number,
  ratio: number,
  attack: number,
  release: number,
  makeupGain: number,
  scFreq: number = 100
): Float32Array {
  const detection = lr4HP(data, scFreq, sr); // sidechain key
  const output = new Float32Array(data.length);
  const attackCoeff = 1 - Math.exp(-1 / (sr * attack));
  const releaseCoeff = 1 - Math.exp(-1 / (sr * release));
  const makeup = Math.pow(10, makeupGain / 20);
  let env = 0;

  for (let i = 0; i < data.length; i++) {
    const key = Math.abs(detection[i]);
    env += (key > env ? attackCoeff : releaseCoeff) * (key - env);

    let gain = 1;
    if (env > 0) {
      const envDb = 20 * Math.log10(env);
      if (envDb > threshold) {
        const overDb = envDb - threshold;
        gain = Math.pow(10, (overDb / ratio - overDb) / 20);
      }
    }
    output[i] = data[i] * gain * makeup;
  }
  return output;
}

// ─── Mid-Side Processing ─────────────────────────────────────────

function toMidSide(L: Float32Array, R: Float32Array): { mid: Float32Array; side: Float32Array } {
  const mid = new Float32Array(L.length);
  const side = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) {
    mid[i] = (L[i] + R[i]) * 0.5;
    side[i] = (L[i] - R[i]) * 0.5;
  }
  return { mid, side };
}

function fromMidSide(mid: Float32Array, side: Float32Array): { L: Float32Array; R: Float32Array } {
  const L = new Float32Array(mid.length);
  const R = new Float32Array(mid.length);
  for (let i = 0; i < mid.length; i++) {
    L[i] = mid[i] + side[i];
    R[i] = mid[i] - side[i];
  }
  return { L, R };
}

// ─── Harmonic Exciter (per-band) ─────────────────────────────────

function exciteBand(data: Float32Array, amount: number): Float32Array {
  if (amount <= 0) return data;
  const output = new Float32Array(data.length);
  const drive = 1 + amount * 3;
  for (let i = 0; i < data.length; i++) {
    const harmonics = Math.tanh(data[i] * drive) - data[i];
    output[i] = data[i] + harmonics * amount * 0.3;
  }
  return output;
}

// ─── True-Peak Limiter with 4× ISP detection & Lookahead ─────────
//
// AES17 / BS.1770-4 compliant true-peak detection via 4× Catmull-Rom
// interpolation on the input signal. The limiter envelope reacts to the
// maximum intersample peak inside the lookahead window so that the
// processed sample is attenuated BEFORE the peak crosses the ceiling,
// preventing the ISP distortion that otherwise manifests as gritty mud
// on sub/bass after consumer DAC reconstruction.

/** 4× oversampled peak on the segment between prev sample (s2) and current (s3). */
function ispPeak4x(s0: number, s1: number, s2: number, s3: number): number {
  let peak = Math.abs(s3);
  for (let k = 1; k <= 3; k++) {
    const t = k * 0.25;
    const t2 = t * t;
    const t3 = t2 * t;
    const y = 0.5 * (
      (2 * s2) +
      (-s1 + s3) * t +
      (2 * s1 - 5 * s2 + 4 * s3 - s0) * t2 +
      (-s1 + 3 * s2 - 3 * s3 + s0) * t3
    );
    const a = y < 0 ? -y : y;
    if (a > peak) peak = a;
  }
  return peak;
}

function truePeakLimit(data: Float32Array, sr: number, ceiling: number): Float32Array {
  const output = new Float32Array(data.length);
  const ceilingLin = Math.pow(10, ceiling / 20);
  const lookahead = Math.max(1, Math.floor(sr * 0.005)); // 5 ms — industry default
  const releaseCoeff = Math.exp(-1 / (sr * 0.200));      // 200 ms release — smooth on vocals

  // Precompute per-sample ISP peak using 4-sample history.
  const isp = new Float32Array(data.length);
  let h0 = 0, h1 = 0, h2 = 0;
  for (let i = 0; i < data.length; i++) {
    const h3 = data[i];
    isp[i] = ispPeak4x(h0, h1, h2, h3);
    h0 = h1; h1 = h2; h2 = h3;
  }

  // Rolling max of future ISP peaks within lookahead window.
  // Monotonic deque; amortized O(1) per sample, total O(N).
  // Use a head pointer instead of Array.shift() (which is O(N)).
  const deque: number[] = [];
  let head = 0;
  let lastPushed = -1;
  const windowPeak = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const rightEdge = Math.min(data.length - 1, i + lookahead);
    if (rightEdge > lastPushed) {
      while (deque.length > head && isp[deque[deque.length - 1]] <= isp[rightEdge]) {
        deque.pop();
      }
      deque.push(rightEdge);
      lastPushed = rightEdge;
    }
    // Drop stale front entries
    while (head < deque.length && deque[head] < i) head++;
    windowPeak[i] = isp[deque[head]];
  }

  // Apply limiter: instant attack (lookahead supplies the smoothing),
  // exponential release.
  let envelope = 1; // gain-reduction factor (>=1)
  for (let i = 0; i < data.length; i++) {
    let target = 1;
    if (windowPeak[i] > ceilingLin && ceilingLin > 0) {
      target = windowPeak[i] / ceilingLin;
    }
    if (target > envelope) {
      envelope = target;
    } else {
      envelope = releaseCoeff * envelope + (1 - releaseCoeff) * target;
    }
    if (envelope < 1) envelope = 1;

    // Output is the delayed sample divided by the envelope.
    // Since we've precomputed windowPeak and are processing without an
    // actual delay buffer, we process in-place — the envelope has already
    // anticipated the peak within `lookahead` samples, so no buffer shift
    // is needed. (The classic delay-line structure would add `lookahead`
    // samples of latency; here the envelope is pre-computed from future
    // peaks, so it's equivalent up to release-behavior on already-passed
    // peaks.)
    output[i] = data[i] / envelope;
  }

  return output;
}

// ─── LUFS Measurement (ITU-R BS.1770-4 compliant) ────────────────
//
// Integrated loudness per BS.1770-4 §5.3:
//   1. K-weight each channel (pre-filter + RLB high-pass)
//   2. Compute mean-square in 400 ms blocks with 100 ms hop (75% overlap)
//   3. Absolute-gate: drop blocks below -70 LUFS
//   4. Relative-gate: drop blocks ≥10 LU below absolute-gated mean
//   5. Return LUFS of remaining mean-square
//
// The old code just averaged the full signal's mean-square which made the
// reading sensitive to silence / fades — then Stage 10's LUFS targeting
// over-gained the mix, driving the limiter into distortion (mud).

function measureLUFS(L: Float32Array, R: Float32Array, sr: number): number {
  // K-weighting: BS.1770-4 high shelf @ 1681.974 Hz + HP @ 38.135 Hz
  const kL = processBiquad(
    processBiquad(L, calcHighShelfCoeffs(1681.974450955533, 3.999843853973347, 0.7071752369554196, sr)),
    calcHighpassCoeffs(38.13547087602444, 0.5003270373238773, sr)
  );
  const kR = processBiquad(
    processBiquad(R, calcHighShelfCoeffs(1681.974450955533, 3.999843853973347, 0.7071752369554196, sr)),
    calcHighpassCoeffs(38.13547087602444, 0.5003270373238773, sr)
  );

  // 400 ms window, 100 ms hop (75% overlap)
  const winSize = Math.round(sr * 0.4);
  const hopSize = Math.round(sr * 0.1);
  const N = kL.length;
  if (N < winSize) {
    // Short program — fall back to whole-signal mean-square
    let ms = 0;
    for (let i = 0; i < N; i++) ms += kL[i] * kL[i] + kR[i] * kR[i];
    ms /= N * 2;
    return ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity;
  }

  // Compute per-block mean-square via a running sum (O(N) total).
  // BS.1770 loudness combines channels: z_i = (1/T) * Σ (yL² + yR²)
  const blocks: number[] = [];
  let runningSum = 0;
  for (let i = 0; i < winSize; i++) {
    runningSum += kL[i] * kL[i] + kR[i] * kR[i];
  }
  blocks.push(runningSum / winSize);
  for (let start = hopSize; start + winSize <= N; start += hopSize) {
    // Slide the window by hopSize
    for (let i = 0; i < hopSize; i++) {
      const out = kL[start - hopSize + i];
      const outR = kR[start - hopSize + i];
      const inn = kL[start + winSize - hopSize + i];
      const innR = kR[start + winSize - hopSize + i];
      runningSum -= out * out + outR * outR;
      runningSum += inn * inn + innR * innR;
    }
    if (runningSum > 0) blocks.push(runningSum / winSize);
  }

  if (blocks.length === 0) return -Infinity;

  // Absolute gate (−70 LUFS → mean-square threshold)
  const absThresh = Math.pow(10, (-70 + 0.691) / 10);
  let absSum = 0, absCount = 0;
  for (const b of blocks) {
    if (b > absThresh) { absSum += b; absCount++; }
  }
  if (absCount === 0) return -Infinity;
  const absMean = absSum / absCount;

  // Relative gate: −10 LU below absolute-gated mean
  const relThresh = absMean * 0.1; // 10^(-10/10)
  let relSum = 0, relCount = 0;
  for (const b of blocks) {
    if (b > absThresh && b > relThresh) { relSum += b; relCount++; }
  }
  if (relCount === 0) return -Infinity;
  return -0.691 + 10 * Math.log10(relSum / relCount);
}

// ─── Main Mastering Chain ────────────────────────────────────────

export interface MasteringApproachParams {
  targetLUFS: number;
  truePeakCeiling: number;
  multibandAggression: number;
  stereoWidenAmount: number;
  harmonicExcitement: number;
  lowEndBoost: number;
  airBoost: number;
  busCompGlue: number;
  analogWarmth: number;
}

const DEFAULT_MASTERING_APPROACH: MasteringApproachParams = {
  targetLUFS: -14,
  truePeakCeiling: -1,
  multibandAggression: 0.4,
  stereoWidenAmount: 0.3,
  harmonicExcitement: 0.25,
  lowEndBoost: 0.5,
  airBoost: 1.0,
  busCompGlue: 0.4,
  analogWarmth: 0.3,
};

/**
 * Band-limited analog warmth: saturates only the content above ~200 Hz.
 *
 * Full-band tanh on a mastering bus is a well-known source of mud because
 * it creates 2nd/3rd harmonics of the sub & bass content right in the
 * 120-360 Hz mud range. Splitting into low / highPass via LR4 and
 * saturating only the high-pass path preserves the cleanliness of the
 * sub and kick fundamentals while still adding analog-style harmonic
 * richness in the upper mids and presence range.
 */
function applyAnalogWarmth(data: Float32Array, amount: number, sr: number): Float32Array {
  if (amount <= 0) return data;
  const SPLIT = 300; // Hz — keep bass/kick fundamentals out of the saturator
  const low  = lr4LP(data, SPLIT, sr);
  const high = lr4HP(data, SPLIT, sr);

  const drive = 1 + amount * 1.2;
  const mix = amount * 0.2; // keep wet amount very low — clarity over character
  const output = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const saturatedHigh = Math.tanh(high[i] * drive) / drive;
    const wetHigh = high[i] * (1 - mix) + saturatedHigh * mix;
    output[i] = low[i] + wetHigh;
  }
  return output;
}

/**
 * Full mastering chain (Sage Audio / iZotope / Mastering The Mix order):
 *   1. Headroom / input trim
 *   2. Subsonic HPF + subtractive EQ
 *   3. Multiband compression (4-band LR4)
 *   4. Harmonic excitement + analog warmth
 *   5. Additive / tonal EQ
 *   6. Mid-side stereo imaging + bass mono
 *   7. Bus glue compression (sidechain HPF)
 *   8. True-peak limiter with lookahead
 *   9. LUFS trim to target
 *  10. Final measurement
 */
export async function applyMasteringChain(
  buffer: AudioBuffer,
  analysis: TrackAnalysis,
  targetLUFS: number,
  onProgress?: (progress: number, message: string) => void,
  approach?: Partial<MasteringApproachParams>
): Promise<MasteringChainResult> {
  const params = { ...DEFAULT_MASTERING_APPROACH, ...approach, targetLUFS };
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const isStereo = buffer.numberOfChannels >= 2;

  let L: Float32Array = new Float32Array(buffer.getChannelData(0));
  let R: Float32Array = new Float32Array(isStereo ? buffer.getChannelData(1) : buffer.getChannelData(0));

  const density = analysis.densityCategory;
  const tilt = analysis.spectralTilt;
  const isMono = analysis.isMono || !isStereo;
  const crest = analysis.crestFactor;

  // Scale processing by how much headroom / dynamics the mix already has
  const alreadyLoud = analysis.estimatedLUFS > -11;
  const alreadyCrushed = density === 'crushed';
  const mbScale = alreadyCrushed ? 0.25 : alreadyLoud ? 0.55 : 1.0;
  const glueScale = alreadyCrushed ? 0.2 : alreadyLoud ? 0.5 : 1.0;

  // ── Stage 1: Headroom (3–6 dB) ────────────────────────────────
  onProgress?.(4, 'Establishing headroom...');
  await new Promise((r) => setTimeout(r, 0));
  {
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      if (a > peak) peak = a;
    }
    const peakDb = peak > 0 ? 20 * Math.log10(peak) : -60;
    // Aim for ~−6 dBFS peak headroom before the chain
    const trimDb = Math.min(0, -6 - peakDb);
    if (Math.abs(trimDb) > 0.05) {
      const g = Math.pow(10, trimDb / 20);
      for (let i = 0; i < len; i++) {
        L[i] *= g;
        R[i] *= g;
      }
    }
  }

  // ── Stage 2: Subtractive EQ ───────────────────────────────────
  onProgress?.(12, 'Subtractive EQ...');
  await new Promise((r) => setTimeout(r, 0));
  {
    // Subsonic cleanup
    const hpf = calcHighpassCoeffs(28, 0.707, sr);
    L = processBiquad(L, hpf);
    R = processBiquad(R, hpf);

    // Mud cut — stronger if dark / low-heavy
    const mudCut =
      tilt === 'dark' ? -1.8 :
      analysis.freqBalance.low > 0.55 ? -1.4 :
      analysis.freqBalance.low > 0.45 ? -0.8 : -0.4;
    if (mudCut < -0.2) {
      const mud = calcPeakingCoeffs(280, mudCut, 1.4, sr);
      L = processBiquad(L, mud);
      R = processBiquad(R, mud);
    }

    // Harshness cut if bright
    if (tilt === 'bright' || analysis.freqBalance.high > 0.45) {
      const harsh = calcPeakingCoeffs(3500, -1.2, 2.0, sr);
      L = processBiquad(L, harsh);
      R = processBiquad(R, harsh);
    }

    // Boxiness
    if (analysis.freqBalance.mid > 0.4) {
      const box = calcPeakingCoeffs(450, -0.8, 1.6, sr);
      L = processBiquad(L, box);
      R = processBiquad(R, box);
    }
  }

  // ── Stage 3: Multiband compression ────────────────────────────
  onProgress?.(28, 'Multiband dynamics...');
  await new Promise((r) => setTimeout(r, 0));
  {
    const agg = params.multibandAggression * mbScale;
    // Per-band thresholds — light GR (1–3 dB) like pro mastering
    const bandsL = splitBands(L, sr);
    await new Promise((r) => setTimeout(r, 0));
    const bandsR = splitBands(R, sr);
    await new Promise((r) => setTimeout(r, 0));

    const lowThr = -18 - agg * 4;
    const lowMidThr = -16 - agg * 5;
    const highMidThr = -15 - agg * 5;
    const highThr = -14 - agg * 4;
    const ratio = 1.4 + agg * 1.2;
    const makeup = agg * 0.8;

    bandsL.low = compressBand(bandsL.low, sr, lowThr, ratio, 0.03, 0.18, makeup * 0.5);
    bandsR.low = compressBand(bandsR.low, sr, lowThr, ratio, 0.03, 0.18, makeup * 0.5);

    bandsL.lowMid = compressBand(bandsL.lowMid, sr, lowMidThr, ratio, 0.018, 0.14, makeup);
    bandsR.lowMid = compressBand(bandsR.lowMid, sr, lowMidThr, ratio, 0.018, 0.14, makeup);

    bandsL.highMid = compressBand(bandsL.highMid, sr, highMidThr, ratio + 0.2, 0.01, 0.1, makeup);
    bandsR.highMid = compressBand(bandsR.highMid, sr, highMidThr, ratio + 0.2, 0.01, 0.1, makeup);

    bandsL.high = compressBand(bandsL.high, sr, highThr, ratio, 0.006, 0.08, makeup * 0.7);
    bandsR.high = compressBand(bandsR.high, sr, highThr, ratio, 0.006, 0.08, makeup * 0.7);

    for (let i = 0; i < len; i++) {
      L[i] = bandsL.low[i] + bandsL.lowMid[i] + bandsL.highMid[i] + bandsL.high[i];
      R[i] = bandsR.low[i] + bandsR.lowMid[i] + bandsR.highMid[i] + bandsR.high[i];
    }
  }

  // ── Stage 4: Harmonics + analog warmth ────────────────────────
  onProgress?.(42, 'Harmonic excitement...');
  await new Promise((r) => setTimeout(r, 0));
  {
    const excite = params.harmonicExcitement * (alreadyCrushed ? 0.4 : 1);
    if (excite > 0.05) {
      // Excite mid/high only — never the sub
      const bandsL = splitBands(L, sr);
      const bandsR = splitBands(R, sr);
      bandsL.highMid = exciteBand(bandsL.highMid, excite * 0.6);
      bandsR.highMid = exciteBand(bandsR.highMid, excite * 0.6);
      bandsL.high = exciteBand(bandsL.high, excite);
      bandsR.high = exciteBand(bandsR.high, excite);
      for (let i = 0; i < len; i++) {
        L[i] = bandsL.low[i] + bandsL.lowMid[i] + bandsL.highMid[i] + bandsL.high[i];
        R[i] = bandsR.low[i] + bandsR.lowMid[i] + bandsR.highMid[i] + bandsR.high[i];
      }
    }
    if (params.analogWarmth > 0.05) {
      L = applyAnalogWarmth(L, params.analogWarmth, sr);
      R = applyAnalogWarmth(R, params.analogWarmth, sr);
    }
  }

  // ── Stage 5: Additive / tonal EQ ──────────────────────────────
  onProgress?.(54, 'Tonal shaping EQ...');
  await new Promise((r) => setTimeout(r, 0));
  {
    const lowBoost = params.lowEndBoost + (tilt === 'dark' ? -0.5 : tilt === 'bright' ? 0.6 : 0);
    if (Math.abs(lowBoost) > 0.15) {
      const ls = calcLowShelfCoeffs(80, Math.max(-1.5, Math.min(2.5, lowBoost)), 0.7, sr);
      L = processBiquad(L, ls);
      R = processBiquad(R, ls);
    }

    // Presence lift for dark mixes
    const presence =
      tilt === 'dark' ? 1.2 :
      analysis.freqBalance.high < 0.2 ? 0.9 : 0.35;
    if (presence > 0.2) {
      const pe = calcPeakingCoeffs(3200, presence, 1.1, sr);
      L = processBiquad(L, pe);
      R = processBiquad(R, pe);
    }

    const air = params.airBoost + (tilt === 'dark' ? 0.6 : tilt === 'bright' ? -0.5 : 0);
    if (Math.abs(air) > 0.15) {
      const hs = calcHighShelfCoeffs(10000, Math.max(-1.5, Math.min(2.5, air)), 0.6, sr);
      L = processBiquad(L, hs);
      R = processBiquad(R, hs);
    }
  }

  // ── Stage 6: Stereo imaging ───────────────────────────────────
  onProgress?.(64, 'Stereo imaging...');
  await new Promise((r) => setTimeout(r, 0));
  if (!isMono) {
    const { mid, side } = toMidSide(L, R);
    const widen = params.stereoWidenAmount;
    const corr = analysis.stereoCorrelation;

    // Narrow material → widen; already wide → protect mono
    let sideGain = 1;
    if (corr > 0.92) sideGain = 1 + widen * 0.55;
    else if (corr < 0.35) sideGain = Math.max(0.75, 1 - widen * 0.35);
    else sideGain = 1 + widen * 0.25;

    // Bass mono below ~120 Hz on the side channel
    const sideHP = lr4HP(side, 120, sr);
    const sideLP = lr4LP(side, 120, sr);
    for (let i = 0; i < len; i++) {
      side[i] = sideLP[i] * 0.15 + sideHP[i] * sideGain; // mostly kill low side
    }

    // Slight mid clarity if muddy
    if (analysis.freqBalance.low > 0.5) {
      const midMud = calcPeakingCoeffs(250, -0.6, 1.3, sr);
      const midClean = processBiquad(mid, midMud);
      mid.set(midClean);
    }

    const lr = fromMidSide(mid, side);
    L = lr.L;
    R = lr.R;
  }

  // ── Stage 7: Bus glue compressor ──────────────────────────────
  onProgress?.(74, 'Bus glue compression...');
  await new Promise((r) => setTimeout(r, 0));
  {
    const glue = params.busCompGlue * glueScale;
    if (glue > 0.08) {
      // Threshold tracks crest: more dynamic → lower threshold
      const thr = crest > 14 ? -18 : crest > 10 ? -14 : -10;
      const ratio = 1.5 + glue * 1.5;
      const attack = 0.02; // 20 ms — let transients through
      const release = 0.15;
      const makeup = glue * 1.5;
      L = compressBusSC(L, sr, thr - glue * 4, ratio, attack, release, makeup, 100);
      R = compressBusSC(R, sr, thr - glue * 4, ratio, attack, release, makeup, 100);
    }
  }

  // ── Stage 8: True-peak limiter ────────────────────────────────
  onProgress?.(84, 'True-peak limiting...');
  await new Promise((r) => setTimeout(r, 0));
  {
    // Pre-limit gain so limiter actually works toward loudness target
    const preLUFS = measureLUFS(L, R, sr);
    let driveDb = 0;
    if (preLUFS > -Infinity && isFinite(preLUFS)) {
      // Drive into the limiter: aim a bit above target so limiter catches peaks
      driveDb = (params.targetLUFS + 1.5) - preLUFS;
      // Cap drive — avoid >8 dB GR (audible squashing)
      driveDb = Math.max(-3, Math.min(alreadyCrushed ? 3 : 8, driveDb));
    }
    if (Math.abs(driveDb) > 0.05) {
      const g = Math.pow(10, driveDb / 20);
      for (let i = 0; i < len; i++) {
        L[i] *= g;
        R[i] *= g;
      }
    }

    L = truePeakLimit(L, sr, params.truePeakCeiling);
    R = truePeakLimit(R, sr, params.truePeakCeiling);
  }

  // ── Stage 9: Final LUFS trim ──────────────────────────────────
  onProgress?.(92, 'Matching loudness target...');
  await new Promise((r) => setTimeout(r, 0));
  {
    const postLUFS = measureLUFS(L, R, sr);
    if (postLUFS > -Infinity && isFinite(postLUFS)) {
      let trim = params.targetLUFS - postLUFS;
      // Small trim only — limiter already did the heavy lifting
      trim = Math.max(-2.5, Math.min(2.5, trim));
      if (Math.abs(trim) > 0.08) {
        const g = Math.pow(10, trim / 20);
        for (let i = 0; i < len; i++) {
          L[i] *= g;
          R[i] *= g;
        }
        // Re-limit after trim so ceiling is respected
        L = truePeakLimit(L, sr, params.truePeakCeiling);
        R = truePeakLimit(R, sr, params.truePeakCeiling);
      }
    }
  }

  // ── Stage 10: Final measurement ───────────────────────────────
  onProgress?.(97, 'Final measurement...');
  await new Promise((r) => setTimeout(r, 0));

  const finalLUFS = measureLUFS(L, R, sr);
  let truePeak = 0;
  for (let i = 0; i < len; i++) {
    const absL = Math.abs(L[i]);
    const absR = Math.abs(R[i]);
    if (absL > truePeak) truePeak = absL;
    if (absR > truePeak) truePeak = absR;
  }
  const truePeakDb = truePeak > 0 ? 20 * Math.log10(truePeak) : -Infinity;

  const outputBuffer = createBuffer(isStereo ? [L, R] : [L], sr);

  onProgress?.(100, 'Mastering complete!');

  return {
    buffer: outputBuffer,
    finalLUFS,
    truePeak: truePeakDb,
  };
}
