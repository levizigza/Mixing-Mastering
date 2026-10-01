/**
 * Mix clarity metrics + light pre-master gate.
 *
 * Philosophy (studio quality):
 * - Prefer leaving the mix alone.
 * - Only carve when low-mids truly mask presence.
 * - Never stack HPF / presence / deep mud cuts that other stages already own.
 */

export interface ClarityMetrics {
  mudRatio: number;
  lowMidShare: number;
  presenceShare: number;
  rms: number;
  clarity: number;
}

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function calcPeaking(freq: number, gain: number, Q: number, sr: number): BiquadCoeffs {
  const A = Math.pow(10, gain / 40);
  const w0 = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const b0 = 1 + alpha * A;
  const b1 = -2 * Math.cos(w0);
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha / A;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function processBiquad(data: Float32Array, c: BiquadCoeffs): Float32Array {
  const out = new Float32Array(data.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

function bandEnergy(data: Float32Array, sr: number, lowHz: number, highHz: number, n: number): number {
  const aLo = Math.exp((-2 * Math.PI * lowHz) / sr);
  const aHi = Math.exp((-2 * Math.PI * highHz) / sr);
  let lpLo = 0;
  let lpHi = 0;
  let e = 0;
  for (let i = 0; i < n; i++) {
    const x = data[i];
    lpLo = x + (lpLo - x) * aLo;
    lpHi = x + (lpHi - x) * aHi;
    const band = lpLo - lpHi;
    e += band * band;
  }
  return e / Math.max(1, n);
}

function createBuffer(L: Float32Array, R: Float32Array, sr: number, stereo: boolean): AudioBuffer {
  const ctx = new OfflineAudioContext(stereo ? 2 : 1, L.length, sr);
  const buf = ctx.createBuffer(stereo ? 2 : 1, L.length, sr);
  buf.copyToChannel(new Float32Array(L), 0);
  if (stereo) buf.copyToChannel(new Float32Array(R), 1);
  return buf;
}

export function signalRms(L: Float32Array, R: Float32Array): number {
  let e = 0;
  const n = L.length;
  for (let i = 0; i < n; i++) e += L[i] * L[i] + R[i] * R[i];
  return Math.sqrt(e / Math.max(1, n * 2));
}

export function matchRmsLevel(L: Float32Array, R: Float32Array, target: number): number {
  const cur = signalRms(L, R);
  if (cur < 1e-8 || target < 1e-8) return 1;
  const g = Math.max(Math.pow(10, -0.5 / 20), Math.min(Math.pow(10, 1.0 / 20), target / cur));
  if (Math.abs(g - 1) < 0.002) return 1;
  for (let i = 0; i < L.length; i++) {
    L[i] *= g;
    R[i] *= g;
  }
  return g;
}

export function measureClarity(buffer: AudioBuffer): ClarityMetrics {
  const sr = buffer.sampleRate;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const n = Math.min(L.length, Math.floor(sr * 45));
  const mid = new Float32Array(n);
  for (let i = 0; i < n; i++) mid[i] = (L[i] + R[i]) * 0.5;

  const sub = bandEnergy(mid, sr, 20, 80, n);
  const bass = bandEnergy(mid, sr, 80, 180, n);
  const lowMid = bandEnergy(mid, sr, 180, 450, n);
  const body = bandEnergy(mid, sr, 450, 1500, n);
  const presence = bandEnergy(mid, sr, 1500, 5000, n);
  const air = bandEnergy(mid, sr, 5000, 14000, n);
  const total = sub + bass + lowMid + body + presence + air + 1e-12;
  const vocal = body + presence + 1e-12;

  const mudRatio = lowMid / vocal;
  const lowMidShare = lowMid / total;
  const presenceShare = (presence + air) / total;
  let rmsSum = 0;
  for (let i = 0; i < n; i++) rmsSum += mid[i] * mid[i];
  const rms = Math.sqrt(rmsSum / n);

  const mudPenalty = Math.max(0, Math.min(1, (mudRatio - 0.7) / 1.4));
  const presenceScore = Math.max(0, Math.min(1, presenceShare / 0.28));
  const clarity = Math.max(0, Math.min(1, 0.55 * (1 - mudPenalty) + 0.45 * presenceScore));

  return { mudRatio, lowMidShare, presenceShare, rms, clarity };
}

export function preferClearer(
  candidate: AudioBuffer,
  reference: AudioBuffer
): { buffer: AudioBuffer; kept: 'candidate' | 'reference'; reason: string } {
  const c = measureClarity(candidate);
  const r = measureClarity(reference);
  const muddier = c.mudRatio > r.mudRatio * 1.08 && c.mudRatio > 0.9;
  const quieter = c.rms < r.rms * Math.pow(10, -0.6 / 20);
  if (muddier || quieter) {
    return {
      buffer: reference,
      kept: 'reference',
      reason: muddier
        ? `Rejected muddy take (mud ${r.mudRatio.toFixed(2)} → ${c.mudRatio.toFixed(2)})`
        : 'Rejected quieter take',
    };
  }
  return { buffer: candidate, kept: 'candidate', reason: 'Candidate kept' };
}

export interface ClarityLockResult {
  buffer: AudioBuffer;
  notes: string[];
  before: ClarityMetrics;
  after: ClarityMetrics;
}

/**
 * Pre-master clarity gate — mostly a no-op.
 * Only a shallow mud carve when truly masked; no HPF, no presence stack.
 */
export async function applyClarityLock(
  buffer: AudioBuffer,
  onProgress?: (p: number, m: string) => void
): Promise<ClarityLockResult> {
  const notes: string[] = [];
  const before = measureClarity(buffer);
  onProgress?.(20, 'Clarity gate: measuring...');
  await new Promise((r) => setTimeout(r, 0));

  // Leave healthy mixes completely alone
  if (before.mudRatio < 1.05) {
    notes.push(
      `Clarity OK (mud ${before.mudRatio.toFixed(2)}) — no carve (preserves body)`
    );
    onProgress?.(100, 'Clarity gate: pass-through');
    return { buffer, notes, before, after: before };
  }

  const sr = buffer.sampleRate;
  const stereo = buffer.numberOfChannels >= 2;
  let L = new Float32Array(buffer.getChannelData(0));
  let R = new Float32Array(stereo ? buffer.getChannelData(1) : buffer.getChannelData(0));
  const targetRms = signalRms(L, R);

  onProgress?.(55, 'Clarity gate: light mud carve...');
  await new Promise((r) => setTimeout(r, 0));

  const carve = Math.max(-1.1, Math.min(-0.4, -0.55 * (before.mudRatio - 0.9) * 2));
  L = new Float32Array(processBiquad(L, calcPeaking(310, carve, 1.35, sr)));
  R = new Float32Array(processBiquad(R, calcPeaking(310, carve, 1.35, sr)));
  notes.push(`Light mud carve ${carve.toFixed(1)} dB @310 Hz (severe mask only)`);

  matchRmsLevel(L, R, targetRms);
  const out = createBuffer(L, R, sr, stereo);
  const after = measureClarity(out);

  if (after.clarity + 0.02 < before.clarity) {
    notes.push('Carve reverted — original had more body');
    onProgress?.(100, 'Clarity gate: reverted');
    return { buffer, notes, before, after: before };
  }

  notes.push(
    `Clarity ${before.clarity.toFixed(2)} → ${after.clarity.toFixed(2)} · mud ${before.mudRatio.toFixed(2)} → ${after.mudRatio.toFixed(2)}`
  );
  onProgress?.(100, 'Clarity gate complete');
  return { buffer: out, notes, before, after };
}

export function claritySafeMasteringApproach<T extends {
  lowEndBoost: number;
  analogWarmth: number;
  harmonicExcitement: number;
  airBoost: number;
  busCompGlue: number;
  multibandAggression: number;
}>(approach: T, metrics: ClarityMetrics): T {
  const muddy = metrics.mudRatio > 0.95 || metrics.lowMidShare > 0.3;
  return {
    ...approach,
    lowEndBoost: muddy ? Math.min(approach.lowEndBoost, 0.1) : Math.min(approach.lowEndBoost, 0.35),
    analogWarmth: Math.min(approach.analogWarmth, muddy ? 0.08 : 0.18),
    harmonicExcitement: Math.min(approach.harmonicExcitement, muddy ? 0.12 : 0.22),
    airBoost: Math.min(approach.airBoost, 1.2),
    busCompGlue: Math.min(approach.busCompGlue, muddy ? 0.28 : 0.42),
    multibandAggression: Math.min(approach.multibandAggression, muddy ? 0.28 : 0.45),
  };
}
