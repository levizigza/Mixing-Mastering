/**
 * Mix clarity lock — permanent quality guard for the Assembly Line.
 *
 * Subtractive-first: never invent bass/warmth that re-muddies a mix.
 * Used by Producer Pass, Smart Enhance, and a pre-master clarity stage
 * so muddy / quiet / incoherent takes cannot ship.
 */

export interface ClarityMetrics {
  /** low-mid (180–450) / vocal band (1.5–5 kHz) — higher = muddier */
  mudRatio: number;
  /** low-mid fraction of full spectrum energy 0–1 */
  lowMidShare: number;
  /** presence + air vs body — higher = clearer */
  presenceShare: number;
  /** mid-channel RMS */
  rms: number;
  /** 0–1 clarity score (1 = clean & coherent) */
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

function calcHighpass(freq: number, Q: number, sr: number): BiquadCoeffs {
  const w0 = (2 * Math.PI * freq) / sr;
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

function calcHighShelf(freq: number, gain: number, Q: number, sr: number): BiquadCoeffs {
  const A = Math.pow(10, gain / 40);
  const w0 = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const cosW = Math.cos(w0);
  const sqrtA = Math.sqrt(A);
  const b0 = A * (A + 1 + (A - 1) * cosW + 2 * sqrtA * alpha);
  const b1 = -2 * A * (A - 1 + (A + 1) * cosW);
  const b2 = A * (A + 1 + (A - 1) * cosW - 2 * sqrtA * alpha);
  const a0 = A + 1 - (A - 1) * cosW + 2 * sqrtA * alpha;
  const a1 = 2 * (A - 1 - (A + 1) * cosW);
  const a2 = A + 1 - (A - 1) * cosW - 2 * sqrtA * alpha;
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
  // Keep restoration modest — never “fix” a bad filter with +6 dB.
  const g = Math.max(Math.pow(10, -0.8 / 20), Math.min(Math.pow(10, 1.5 / 20), target / cur));
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

  // Clarity: punish mud, reward presence without harsh air dominance
  const mudPenalty = Math.max(0, Math.min(1, (mudRatio - 0.55) / 1.2));
  const presenceScore = Math.max(0, Math.min(1, presenceShare / 0.28));
  const clarity = Math.max(0, Math.min(1, 0.55 * (1 - mudPenalty) + 0.45 * presenceScore));

  return { mudRatio, lowMidShare, presenceShare, rms, clarity };
}

/**
 * Reject a candidate if it got muddier or quieter than the reference.
 * Returns the safer buffer.
 */
export function preferClearer(
  candidate: AudioBuffer,
  reference: AudioBuffer
): { buffer: AudioBuffer; kept: 'candidate' | 'reference'; reason: string } {
  const c = measureClarity(candidate);
  const r = measureClarity(reference);
  const muddier = c.mudRatio > r.mudRatio * 1.05 && c.mudRatio > 0.75;
  const lessClear = c.clarity + 0.03 < r.clarity;
  const quieter = c.rms < r.rms * Math.pow(10, -0.5 / 20);

  if (muddier || (lessClear && quieter) || (muddier && lessClear)) {
    return {
      buffer: reference,
      kept: 'reference',
      reason: muddier
        ? `Rejected muddy take (mud ${r.mudRatio.toFixed(2)} → ${c.mudRatio.toFixed(2)})`
        : `Rejected quieter/less-clear take`,
    };
  }
  return { buffer: candidate, kept: 'candidate', reason: 'Candidate clearer or equal' };
}

export interface ClarityLockResult {
  buffer: AudioBuffer;
  notes: string[];
  before: ClarityMetrics;
  after: ClarityMetrics;
}

/**
 * Permanent pre-master clarity lock.
 * Subtractive only — HPF, mud carve, optional tiny presence. No bass/warmth boosts.
 */
export async function applyClarityLock(
  buffer: AudioBuffer,
  onProgress?: (p: number, m: string) => void
): Promise<ClarityLockResult> {
  const notes: string[] = [];
  const sr = buffer.sampleRate;
  const stereo = buffer.numberOfChannels >= 2;
  let L = new Float32Array(buffer.getChannelData(0));
  let R = new Float32Array(stereo ? buffer.getChannelData(1) : buffer.getChannelData(0));
  const before = measureClarity(buffer);
  const targetRms = signalRms(L, R);

  onProgress?.(10, 'Clarity lock: measuring mud & presence...');
  await new Promise((r) => setTimeout(r, 0));

  // Always gentle subsonic cleanup
  L = new Float32Array(processBiquad(L, calcHighpass(32, 0.707, sr)));
  R = new Float32Array(processBiquad(R, calcHighpass(32, 0.707, sr)));
  notes.push('Subsonic HPF @32 Hz');

  onProgress?.(40, 'Clarity lock: carving low-mid mud...');
  await new Promise((r) => setTimeout(r, 0));

  // Progressive mud carve — only when measured muddy
  if (before.mudRatio > 0.7) {
    const carve = Math.max(-2.4, Math.min(-0.6, -0.9 * (before.mudRatio - 0.55) * 2.5));
    L = new Float32Array(processBiquad(L, calcPeaking(300, carve, 1.25, sr)));
    R = new Float32Array(processBiquad(R, calcPeaking(300, carve, 1.25, sr)));
    notes.push(`Mud carve ${carve.toFixed(1)} dB @300 Hz`);
  }
  if (before.lowMidShare > 0.28) {
    const box = Math.max(-1.4, -0.7 * (before.lowMidShare - 0.22) * 4);
    if (box < -0.25) {
      L = new Float32Array(processBiquad(L, calcPeaking(450, box, 1.5, sr)));
      R = new Float32Array(processBiquad(R, calcPeaking(450, box, 1.5, sr)));
      notes.push(`Boxiness carve ${box.toFixed(1)} dB @450 Hz`);
    }
  }

  onProgress?.(70, 'Clarity lock: opening presence if thin...');
  await new Promise((r) => setTimeout(r, 0));

  // Only open presence when the mix is actually veiled — never pile air on bright material
  if (before.presenceShare < 0.18 && before.mudRatio > 0.65) {
    const pres = Math.min(1.1, 0.55 + (0.18 - before.presenceShare) * 3);
    L = new Float32Array(processBiquad(L, calcPeaking(3100, pres, 1.15, sr)));
    R = new Float32Array(processBiquad(R, calcPeaking(3100, pres, 1.15, sr)));
    const air = Math.min(0.7, 0.35);
    L = new Float32Array(processBiquad(L, calcHighShelf(12000, air, 0.7, sr)));
    R = new Float32Array(processBiquad(R, calcHighShelf(12000, air, 0.7, sr)));
    notes.push(`Presence +${pres.toFixed(1)} · air +${air.toFixed(1)} (veiled mix)`);
  } else if (before.presenceShare < 0.14) {
    const pres = 0.55;
    L = new Float32Array(processBiquad(L, calcPeaking(3200, pres, 1.2, sr)));
    R = new Float32Array(processBiquad(R, calcPeaking(3200, pres, 1.2, sr)));
    notes.push(`Presence +${pres.toFixed(1)} dB`);
  } else {
    notes.push('Presence already sufficient — left alone');
  }

  matchRmsLevel(L, R, targetRms);

  // Soft peak ceiling only
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  if (peak > 0.97) {
    const g = 0.97 / peak;
    for (let i = 0; i < L.length; i++) {
      L[i] *= g;
      R[i] *= g;
    }
  }

  const out = createBuffer(L, R, sr, stereo);
  const after = measureClarity(out);

  // Hard gate: if we somehow made it worse, return original
  if (after.mudRatio > before.mudRatio * 1.04 && after.clarity < before.clarity) {
    notes.push('Clarity lock reverted — original was clearer');
    onProgress?.(100, 'Clarity lock complete (reverted)');
    return { buffer, notes, before, after: before };
  }

  notes.push(
    `Clarity ${before.clarity.toFixed(2)} → ${after.clarity.toFixed(2)} · mud ${before.mudRatio.toFixed(2)} → ${after.mudRatio.toFixed(2)}`
  );
  onProgress?.(100, 'Clarity lock complete');
  return { buffer: out, notes, before, after };
}

/**
 * Cap mastering low-end / warmth when the program is already muddy.
 * Call before applyMasteringChain so the master cannot re-muddy the mix.
 */
export function claritySafeMasteringApproach<T extends {
  lowEndBoost: number;
  analogWarmth: number;
  harmonicExcitement: number;
  airBoost: number;
  busCompGlue: number;
  multibandAggression: number;
}>(approach: T, metrics: ClarityMetrics): T {
  const muddy = metrics.mudRatio > 0.8 || metrics.lowMidShare > 0.26;
  const veiled = metrics.presenceShare < 0.16;

  return {
    ...approach,
    lowEndBoost: muddy ? Math.min(approach.lowEndBoost, 0.15) : Math.min(approach.lowEndBoost, 0.7),
    analogWarmth: muddy ? Math.min(approach.analogWarmth, 0.12) : Math.min(approach.analogWarmth, 0.35),
    harmonicExcitement: Math.min(approach.harmonicExcitement, muddy ? 0.2 : 0.4),
    airBoost: veiled ? Math.max(approach.airBoost, 0.8) : Math.min(approach.airBoost, 1.6),
    busCompGlue: Math.min(approach.busCompGlue, muddy ? 0.35 : 0.55),
    multibandAggression: Math.min(approach.multibandAggression, muddy ? 0.35 : 0.6),
  };
}
