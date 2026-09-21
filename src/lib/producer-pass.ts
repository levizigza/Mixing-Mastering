/**
 * Producer Pass — iterative “intangibles” polish.
 *
 * Simulates a hitmaker / producer listening several times and making
 * small taste-driven moves: tonal interplay, beat-element cohesion,
 * mid/side glue, low-end pocket, and radio-ready breath.
 *
 * Intentionally subtle (Rick Rubin restraint) — not another loudness
 * or Smart Enhance pass. Browser DSP only; no ML.
 */

import { detectSonicCharacter, SonicCharacter } from '@/lib/sonic-character';
import { SongSection } from '@/types/audio';

export interface ProducerPassResult {
  buffer: AudioBuffer;
  notes: string[];
  listens: number;
  cohesionScore: number;
  character: SonicCharacter;
}

export interface ProducerPassOptions {
  onProgress?: (p: number, m: string) => void;
  /** Overall taste intensity 0–1 (default adaptive ~0.55) */
  intensity?: number;
  signal?: AbortSignal;
}

interface CohesionMetrics {
  /** 0–1 higher = better tonal balance across bands */
  tonalBalance: number;
  /** 0–1 mid vs side energy relationship (elements locking) */
  midSideLock: number;
  /** 0–1 kick/bass pocket (low vs low-mid not fighting) */
  lowPocket: number;
  /** 0–1 transient vs body (punch without thinness) */
  bodyPunch: number;
  /** 0–1 stereo image stability */
  imageStability: number;
  /** Combined taste score */
  score: number;
}

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const err = new Error('Producer Pass cancelled');
    err.name = 'AbortError';
    throw err;
  }
}

async function yieldToUI() {
  await new Promise<void>((r) => setTimeout(r, 0));
}

function calcPeaking(freq: number, gain: number, Q: number, sr: number): BiquadCoeffs {
  const A = Math.pow(10, gain / 40);
  const w0 = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const b0 = 1 + alpha * A;
  const b1 = -2 * Math.cos(w0);
  const b2 = 1 + alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha / A;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function calcLowShelf(freq: number, gain: number, Q: number, sr: number): BiquadCoeffs {
  const A = Math.pow(10, gain / 40);
  const w0 = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const cosW = Math.cos(w0);
  const sqrtA = Math.sqrt(A);
  const b0 = A * (A + 1 - (A - 1) * cosW + 2 * sqrtA * alpha);
  const b1 = 2 * A * (A - 1 + (A + 1) * cosW);
  const b2 = A * (A + 1 - (A - 1) * cosW - 2 * sqrtA * alpha);
  const a0 = A + 1 + (A - 1) * cosW + 2 * sqrtA * alpha;
  const a1 = -2 * (A - 1 + (A + 1) * cosW);
  const a2 = A + 1 + (A - 1) * cosW - 2 * sqrtA * alpha;
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

function createBuffer(L: Float32Array, R: Float32Array, sr: number, stereo: boolean): AudioBuffer {
  const ctx = new OfflineAudioContext(stereo ? 2 : 1, L.length, sr);
  const buf = ctx.createBuffer(stereo ? 2 : 1, L.length, sr);
  buf.copyToChannel(new Float32Array(L), 0);
  if (stereo) buf.copyToChannel(new Float32Array(R), 1);
  return buf;
}

function bandEnergy(data: Float32Array, sr: number, lowHz: number, highHz: number, maxSamples: number): number {
  const aLo = Math.exp((-2 * Math.PI * lowHz) / sr);
  const aHi = Math.exp((-2 * Math.PI * highHz) / sr);
  let lpLo = 0;
  let lpHi = 0;
  let e = 0;
  const n = Math.min(data.length, maxSamples);
  for (let i = 0; i < n; i++) {
    const x = data[i];
    lpLo = x + (lpLo - x) * aLo;
    lpHi = x + (lpHi - x) * aHi;
    const band = lpLo - lpHi;
    e += band * band;
  }
  return e / Math.max(1, n);
}

/** Measure intangible cohesion — what a producer hears after each listen. */
function measureCohesion(L: Float32Array, R: Float32Array, sr: number): CohesionMetrics {
  const maxSamples = Math.min(L.length, Math.floor(sr * 50));
  const mid = new Float32Array(maxSamples);
  const side = new Float32Array(maxSamples);
  for (let i = 0; i < maxSamples; i++) {
    mid[i] = (L[i] + R[i]) * 0.5;
    side[i] = (L[i] - R[i]) * 0.5;
  }

  const sub = bandEnergy(mid, sr, 20, 80, maxSamples);
  const bass = bandEnergy(mid, sr, 80, 200, maxSamples);
  const lowMid = bandEnergy(mid, sr, 200, 500, maxSamples);
  const midBand = bandEnergy(mid, sr, 500, 2500, maxSamples);
  const high = bandEnergy(mid, sr, 2500, 10000, maxSamples);
  const air = bandEnergy(mid, sr, 10000, 16000, maxSamples);
  const total = sub + bass + lowMid + midBand + high + air + 1e-12;

  // Ideal radio-ish distribution (rough targets as fractions)
  const ideal = [0.14, 0.18, 0.16, 0.28, 0.18, 0.06];
  const actual = [sub, bass, lowMid, midBand, high, air].map((v) => v / total);
  let tonalErr = 0;
  for (let i = 0; i < ideal.length; i++) {
    tonalErr += Math.abs(actual[i] - ideal[i]);
  }
  const tonalBalance = Math.max(0, Math.min(1, 1 - tonalErr / 1.2));

  let midE = 0;
  let sideE = 0;
  for (let i = 0; i < maxSamples; i++) {
    midE += mid[i] * mid[i];
    sideE += side[i] * side[i];
  }
  const msRatio = midE / (midE + sideE + 1e-12);
  // Sweet spot ~0.55–0.72 mid-dominant but not mono
  const midSideLock = Math.max(0, Math.min(1, 1 - Math.abs(msRatio - 0.62) / 0.35));

  // Kick/bass pocket: sub should exist; low-mid shouldn't swamp bass
  const pocketRatio = bass / (lowMid + 1e-12);
  const lowPocket = Math.max(0, Math.min(1, 1 - Math.abs(pocketRatio - 1.15) / 1.4));

  // Transient hardness vs body (crest of mid)
  let peak = 0;
  let rms = 0;
  for (let i = 0; i < maxSamples; i++) {
    const a = Math.abs(mid[i]);
    if (a > peak) peak = a;
    rms += mid[i] * mid[i];
  }
  rms = Math.sqrt(rms / maxSamples);
  const crest = peak > 1e-9 && rms > 1e-9 ? 20 * Math.log10(peak / rms) : 12;
  // Radio-ready often ~8–14 dB crest
  const bodyPunch = Math.max(0, Math.min(1, 1 - Math.abs(crest - 11) / 10));

  // Image stability: correlation variance across blocks
  const block = Math.floor(sr * 0.25);
  const corrs: number[] = [];
  for (let start = 0; start + block < maxSamples; start += block) {
    let sumLR = 0;
    let sumL2 = 0;
    let sumR2 = 0;
    for (let i = start; i < start + block; i++) {
      sumLR += L[i] * R[i];
      sumL2 += L[i] * L[i];
      sumR2 += R[i] * R[i];
    }
    const denom = Math.sqrt(sumL2 * sumR2) + 1e-12;
    corrs.push(sumLR / denom);
  }
  let meanC = 0;
  for (const c of corrs) meanC += c;
  meanC /= Math.max(1, corrs.length);
  let varC = 0;
  for (const c of corrs) varC += (c - meanC) * (c - meanC);
  varC /= Math.max(1, corrs.length);
  const imageStability = Math.max(0, Math.min(1, 1 - Math.sqrt(varC) * 4));

  const score =
    tonalBalance * 0.28 +
    midSideLock * 0.22 +
    lowPocket * 0.2 +
    bodyPunch * 0.18 +
    imageStability * 0.12;

  return { tonalBalance, midSideLock, lowPocket, bodyPunch, imageStability, score };
}

/** Soft bus glue — locks elements without crushing. */
function applyGlue(
  L: Float32Array,
  R: Float32Array,
  sr: number,
  amount: number
): { L: Float32Array; R: Float32Array } {
  if (amount < 0.05) return { L, R };
  const outL = new Float32Array(L.length);
  const outR = new Float32Array(R.length);
  const thresh = 0.18;
  const ratio = 1.4 + amount * 1.2;
  const att = 1 - Math.exp(-1 / (sr * 0.012));
  const rel = 1 - Math.exp(-1 / (sr * 0.18));
  let env = 0;
  const makeup = 1 + amount * 0.06;

  for (let i = 0; i < L.length; i++) {
    const mono = (Math.abs(L[i]) + Math.abs(R[i])) * 0.5;
    env += (mono > env ? att : rel) * (mono - env);
    let g = 1;
    if (env > thresh) {
      const over = env / thresh;
      const compressed = Math.pow(over, 1 / ratio - 1);
      g = compressed;
    }
    // Soften with amount
    g = 1 + (g - 1) * amount;
    outL[i] = L[i] * g * makeup;
    outR[i] = R[i] * g * makeup;
  }
  return { L: outL, R: outR };
}

/**
 * Micro sidechain-feel: when mid low energy spikes (kick), gently dip
 * competing low-mid on sides — elements “work together.”
 */
function applyElementInterplay(
  L: Float32Array,
  R: Float32Array,
  sr: number,
  amount: number
): { L: Float32Array; R: Float32Array } {
  if (amount < 0.05) return { L, R };
  const outL = new Float32Array(L.length);
  const outR = new Float32Array(R.length);
  const lpC = 1 - Math.exp((-2 * Math.PI * 90) / sr);
  let kickEnv = 0;
  const att = 1 - Math.exp(-1 / (sr * 0.003));
  const rel = 1 - Math.exp(-1 / (sr * 0.09));
  let lpKick = 0;

  for (let i = 0; i < L.length; i++) {
    const mid = (L[i] + R[i]) * 0.5;
    const side = (L[i] - R[i]) * 0.5;
    lpKick += lpC * (mid - lpKick);
    const kickAbs = Math.abs(lpKick);
    kickEnv += (kickAbs > kickEnv ? att : rel) * (kickAbs - kickEnv);
    // Dip side low-mid content when kick speaks
    const duck = 1 - Math.min(0.22, kickEnv * amount * 1.8);
    // Soften side only slightly; keep mid intact
    const newSide = side * (0.55 + 0.45 * duck);
    outL[i] = mid + newSide;
    outR[i] = mid - newSide;
  }
  return { L: outL, R: outR };
}

/** Subtle mid/side width breathe for radio cohesion. */
function applyImageTaste(
  L: Float32Array,
  R: Float32Array,
  targetMidRatio: number,
  amount: number
): { L: Float32Array; R: Float32Array } {
  if (amount < 0.04) return { L, R };
  const outL = new Float32Array(L.length);
  const outR = new Float32Array(R.length);
  // Measure current
  let midE = 0;
  let sideE = 0;
  const n = Math.min(L.length, 200000);
  for (let i = 0; i < n; i++) {
    const m = (L[i] + R[i]) * 0.5;
    const s = (L[i] - R[i]) * 0.5;
    midE += m * m;
    sideE += s * s;
  }
  const cur = midE / (midE + sideE + 1e-12);
  const delta = (targetMidRatio - cur) * amount * 0.55;
  const midGain = 1 + delta;
  const sideGain = 1 - delta * 0.85;

  for (let i = 0; i < L.length; i++) {
    const m = (L[i] + R[i]) * 0.5 * midGain;
    const s = (L[i] - R[i]) * 0.5 * sideGain;
    outL[i] = m + s;
    outR[i] = m - s;
  }
  return { L: outL, R: outR };
}

function applyTonalTaste(
  L: Float32Array,
  R: Float32Array,
  sr: number,
  m: CohesionMetrics,
  intensity: number,
  character: SonicCharacter
): { L: Float32Array; R: Float32Array; moves: string[] } {
  const moves: string[] = [];
  let outL = L;
  let outR = R;
  const soft =
    character === 'minimal' ||
    character === 'moody' ||
    character === 'atmospheric' ||
    character === 'soulful';
  const scale = intensity * (soft ? 0.72 : 1);

  // Low pocket: if low-mid fights bass, carve ~280 Hz; if thin, gentle sub shelf
  if (m.lowPocket < 0.72) {
    const carve = -1.4 * (1 - m.lowPocket) * scale;
    outL = processBiquad(outL, calcPeaking(280, carve, 1.1, sr));
    outR = processBiquad(outR, calcPeaking(280, carve, 1.1, sr));
    const shelf = 0.55 * (1 - m.lowPocket) * scale;
    outL = processBiquad(outL, calcLowShelf(75, shelf, 0.7, sr));
    outR = processBiquad(outR, calcLowShelf(75, shelf, 0.7, sr));
    moves.push(`Low-end pocket carve ${carve.toFixed(1)} dB @280 · shelf +${shelf.toFixed(1)}`);
  }

  // Tonal balance: presence / air micro moves toward radio ideal
  if (m.tonalBalance < 0.78) {
    const pres = 0.85 * (1 - m.tonalBalance) * scale * (soft ? 0.7 : 1);
    const air = 0.65 * (1 - m.tonalBalance) * scale;
    outL = processBiquad(outL, calcPeaking(3200, soft ? pres * 0.7 : pres, 1.2, sr));
    outR = processBiquad(outR, calcPeaking(3200, soft ? pres * 0.7 : pres, 1.2, sr));
    outL = processBiquad(outL, calcHighShelf(10500, air, 0.6, sr));
    outR = processBiquad(outR, calcHighShelf(10500, air, 0.6, sr));
    // Slight harshness tame if bright
    if (!soft) {
      const tame = -0.55 * (1 - m.tonalBalance) * scale;
      outL = processBiquad(outL, calcPeaking(4800, tame, 1.6, sr));
      outR = processBiquad(outR, calcPeaking(4800, tame, 1.6, sr));
    }
    moves.push(`Tonality taste · presence/air micro-nudge`);
  }

  // Body vs punch: if too peaky, soft body; if flat, tiny transient lift via high-mid
  if (m.bodyPunch < 0.7) {
    const body = 0.7 * (1 - m.bodyPunch) * scale;
    outL = processBiquad(outL, calcPeaking(180, body * 0.6, 0.9, sr));
    outR = processBiquad(outR, calcPeaking(180, body * 0.6, 0.9, sr));
    outL = processBiquad(outL, calcPeaking(5500, body * 0.45, 1.4, sr));
    outR = processBiquad(outR, calcPeaking(5500, body * 0.45, 1.4, sr));
    moves.push(`Body/punch balance nudge`);
  }

  return { L: outL, R: outR, moves };
}

/**
 * Soft section “breathe” — choruses get a hair more forwardness,
 * quiet parts a hair more space. Producer arrangement feel.
 */
function applyArrangementTaste(
  L: Float32Array,
  R: Float32Array,
  sr: number,
  sections: SongSection[],
  intensity: number
): { L: Float32Array; R: Float32Array; note: string } {
  const outL = new Float32Array(L.length);
  const outR = new Float32Array(R.length);
  const curve = new Float32Array(L.length);
  curve.fill(1);

  if (sections.length >= 2) {
    for (const s of sections) {
      const start = Math.max(0, Math.floor(s.start * sr));
      const end = Math.min(L.length, Math.floor(s.end * sr));
      const kind = (s.kind || '').toLowerCase();
      const name = (s.name || '').toLowerCase();
      let g = 1;
      if (kind === 'chorus' || name.includes('drop') || name.includes('hook')) {
        g = 1 + 0.035 * intensity;
      } else if (kind === 'verse' || kind === 'bridge' || kind === 'outro') {
        g = 1 - 0.02 * intensity;
      } else if (kind === 'intro') {
        g = 1 - 0.015 * intensity;
      }
      for (let i = start; i < end; i++) curve[i] = g;
    }
    // Smooth transitions ~40ms
    const smoothN = Math.floor(sr * 0.04);
    for (let i = 1; i < L.length; i++) {
      const a = Math.min(1, 1 / smoothN);
      curve[i] = curve[i - 1] + a * (curve[i] - curve[i - 1]);
    }
  } else {
    // No sections: gentle middle-forward energy arc
    for (let i = 0; i < L.length; i++) {
      const t = i / L.length;
      const arc = Math.sin(Math.PI * t);
      curve[i] = 1 + (arc - 0.5) * 0.03 * intensity;
    }
  }

  for (let i = 0; i < L.length; i++) {
    outL[i] = L[i] * curve[i];
    outR[i] = R[i] * curve[i];
  }
  return {
    L: outL,
    R: outR,
    note: sections.length
      ? `Arrangement breathe across ${sections.length} sections`
      : 'Gentle song-arc breathe',
  };
}

function normalizePeak(L: Float32Array, R: Float32Array, ceiling = 0.91): void {
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  if (peak > ceiling) {
    const g = ceiling / peak;
    for (let i = 0; i < L.length; i++) {
      L[i] *= g;
      R[i] *= g;
    }
  }
}

/**
 * Run the Producer Pass: multiple listens + micro taste moves until cohesion improves.
 */
export async function applyProducerPass(
  buffer: AudioBuffer,
  sections: SongSection[] = [],
  options: ProducerPassOptions = {}
): Promise<ProducerPassResult> {
  const { onProgress, signal } = options;
  const notes: string[] = [];
  const sr = buffer.sampleRate;
  const stereo = buffer.numberOfChannels >= 2;

  throwIfAborted(signal);
  onProgress?.(3, 'Producer Pass: first listen — reading the intangibles...');
  await yieldToUI();

  const analysis = detectSonicCharacter(buffer);
  const soft =
    analysis.character === 'minimal' ||
    analysis.character === 'moody' ||
    analysis.character === 'atmospheric' ||
    analysis.character === 'soulful';

  let intensity =
    typeof options.intensity === 'number'
      ? Math.max(0.25, Math.min(1, options.intensity))
      : 0.48 + analysis.traits.energy * 0.22 + (1 - analysis.traits.dynamicRange) * 0.12;
  if (soft) intensity *= 0.78;
  if (analysis.character === 'hitmaker' || analysis.character === 'anthemic') {
    intensity = Math.max(intensity, 0.58);
  }
  intensity = Math.max(0.32, Math.min(0.88, intensity));

  notes.push(
    `Producer Pass · vibe ${analysis.character} · taste intensity ${Math.round(intensity * 100)}%`
  );
  notes.push('Simulating multiple producer listens — micro moves only (radio/international polish).');

  let L = new Float32Array(buffer.getChannelData(0));
  let R = new Float32Array(stereo ? buffer.getChannelData(1) : buffer.getChannelData(0));

  let metrics = measureCohesion(L, R, sr);
  const startScore = metrics.score;
  notes.push(
    `Listen 1 cohesion ${Math.round(startScore * 100)}% · tonal ${Math.round(metrics.tonalBalance * 100)} · pocket ${Math.round(metrics.lowPocket * 100)} · lock ${Math.round(metrics.midSideLock * 100)}`
  );

  const LISTENS = 3;
  let listensDone = 1;

  // ── Listen 2: tonality + low-end pocket + image ──────────────
  throwIfAborted(signal);
  onProgress?.(22, 'Producer Pass: listen 2 — tonality & pocket...');
  await yieldToUI();

  {
    const before = metrics.score;
    const prevL = L;
    const prevR = R;
    const tonal = applyTonalTaste(L, R, sr, metrics, intensity, analysis.character);
    L = new Float32Array(tonal.L);
    R = new Float32Array(tonal.R);
    for (const m of tonal.moves) notes.push(`Listen 2: ${m}`);

    const imaged = applyImageTaste(L, R, soft ? 0.58 : 0.64, intensity * 0.85);
    L = new Float32Array(imaged.L);
    R = new Float32Array(imaged.R);

    metrics = measureCohesion(L, R, sr);
    if (metrics.score + 0.002 < before) {
      L = prevL;
      R = prevR;
      metrics = measureCohesion(L, R, sr);
      notes.push('Listen 2: kept prior take (score did not improve).');
    } else {
      notes.push(
        `Listen 2 cohesion ${Math.round(metrics.score * 100)}% (Δ${((metrics.score - before) * 100).toFixed(1)})`
      );
    }
    listensDone = 2;
  }

  // ── Listen 3: element interplay + glue ───────────────────────
  throwIfAborted(signal);
  onProgress?.(48, 'Producer Pass: listen 3 — how the beat elements lock...');
  await yieldToUI();

  {
    const before = metrics.score;
    const interplay = applyElementInterplay(L, R, sr, intensity * 0.75);
    L = new Float32Array(interplay.L);
    R = new Float32Array(interplay.R);

    const glueAmt = (soft ? 0.28 : 0.42) * intensity;
    const glued = applyGlue(L, R, sr, glueAmt);
    L = new Float32Array(glued.L);
    R = new Float32Array(glued.R);
    notes.push(`Listen 3: element interplay + bus glue ${(glueAmt * 100).toFixed(0)}%`);

    metrics = measureCohesion(L, R, sr);
    notes.push(
      `Listen 3 cohesion ${Math.round(metrics.score * 100)}% (Δ${((metrics.score - before) * 100).toFixed(1)})`
    );
    listensDone = 3;
  }

  // ── Listen 4 (final taste): arrangement breathe + last tonal kiss ─
  throwIfAborted(signal);
  onProgress?.(72, 'Producer Pass: final listen — radio-ready taste...');
  await yieldToUI();

  {
    const before = metrics.score;
    const arr = applyArrangementTaste(L, R, sr, sections, intensity * 0.9);
    L = new Float32Array(arr.L);
    R = new Float32Array(arr.R);
    notes.push(`Final listen: ${arr.note}`);

    // Last micro tonal kiss only if still below target
    if (metrics.score < 0.82) {
      const kiss = applyTonalTaste(L, R, sr, metrics, intensity * 0.45, analysis.character);
      L = new Float32Array(kiss.L);
      R = new Float32Array(kiss.R);
      if (kiss.moves.length) notes.push(`Final listen: ${kiss.moves[0]}`);
    }

    // Soft analog-ish even harmonic kiss via gentle soft-clip blend on mid
    const warmAmt = (soft ? 0.08 : 0.05) * intensity;
    if (warmAmt > 0.02) {
      for (let i = 0; i < L.length; i++) {
        const m = (L[i] + R[i]) * 0.5;
        const s = (L[i] - R[i]) * 0.5;
        const warm = Math.tanh(m * (1.15 + warmAmt)) / (1.15 + warmAmt);
        const mixed = m * (1 - warmAmt) + warm * warmAmt;
        L[i] = mixed + s;
        R[i] = mixed - s;
      }
      notes.push('Final listen: subtle console warmth on center');
    }

    metrics = measureCohesion(L, R, sr);
    notes.push(
      `Final cohesion ${Math.round(metrics.score * 100)}% (started ${Math.round(startScore * 100)}% · Δ${((metrics.score - startScore) * 100).toFixed(1)})`
    );
    listensDone = LISTENS + 1;
  }

  normalizePeak(L, R, 0.9);
  await yieldToUI();
  onProgress?.(100, 'Producer Pass complete');

  notes.push(
    listensDone >= 4
      ? 'Four producer listens locked — intangibles polished for radio / international play.'
      : 'Producer listens complete.'
  );

  return {
    buffer: createBuffer(L, R, sr, stereo),
    notes,
    listens: listensDone,
    cohesionScore: metrics.score,
    character: analysis.character,
  };
}
