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
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha / A;
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

function signalRms(L: Float32Array, R: Float32Array): number {
  let e = 0;
  const n = L.length;
  for (let i = 0; i < n; i++) e += L[i] * L[i] + R[i] * R[i];
  return Math.sqrt(e / Math.max(1, n * 2));
}

/** Restore loudness after a taste move. Clamped so a bad filter can't be "fixed" by +6 dB. */
function matchRms(L: Float32Array, R: Float32Array, target: number): number {
  const cur = signalRms(L, R);
  if (cur < 1e-8 || target < 1e-8) return 1;
  const g = Math.max(Math.pow(10, -0.6 / 20), Math.min(Math.pow(10, 1.2 / 20), target / cur));
  if (Math.abs(g - 1) < 0.002) return 1;
  for (let i = 0; i < L.length; i++) {
    L[i] *= g;
    R[i] *= g;
  }
  return g;
}

/**
 * Parallel glue only — dry signal stays intact, wet is gain-matched,
 * then the sum is returned without a static downward gain.
 */
function applyGlue(
  L: Float32Array,
  R: Float32Array,
  sr: number,
  amount: number
): { L: Float32Array; R: Float32Array } {
  if (amount < 0.04) return { L, R };
  const wet = 0.05 + amount * 0.07; // ~5–12% — density, not a level drop
  const compL = new Float32Array(L.length);
  const compR = new Float32Array(R.length);
  const thresh = 0.32;
  const ratio = 1.6;
  const att = 1 - Math.exp(-1 / (sr * 0.02));
  const rel = 1 - Math.exp(-1 / (sr * 0.22));
  let env = 0;

  for (let i = 0; i < L.length; i++) {
    const mono = (Math.abs(L[i]) + Math.abs(R[i])) * 0.5;
    env += (mono > env ? att : rel) * (mono - env);
    let g = 1;
    if (env > thresh) {
      g = Math.pow(env / thresh, 1 / ratio - 1);
    }
    compL[i] = L[i] * g;
    compR[i] = R[i] * g;
  }

  const dryRms = signalRms(L, R);
  const wetRms = signalRms(compL, compR);
  const makeup = wetRms > 1e-8 ? dryRms / wetRms : 1;

  const outL = new Float32Array(L.length);
  const outR = new Float32Array(R.length);
  for (let i = 0; i < L.length; i++) {
    outL[i] = L[i] + (compL[i] * makeup - L[i]) * wet;
    outR[i] = R[i] + (compR[i] * makeup - R[i]) * wet;
  }
  return { L: outL, R: outR };
}

/**
 * Kick pocket: when the low end speaks, dip only ~200–450 Hz (the mud
 * that masks the kick). Does not boost bass and does not collapse the sides.
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
  const aKick = Math.exp((-2 * Math.PI * 100) / sr);
  const aLo = Math.exp((-2 * Math.PI * 200) / sr);
  const aHi = Math.exp((-2 * Math.PI * 450) / sr);
  const att = 1 - Math.exp(-1 / (sr * 0.004));
  const rel = 1 - Math.exp(-1 / (sr * 0.07));
  let kickLp = 0;
  let env = 0;
  let loL = 0;
  let hiL = 0;
  let loR = 0;
  let hiR = 0;
  const maxDuck = 0.1 * amount; // ≤ ~1 dB on the mud band

  for (let i = 0; i < L.length; i++) {
    const mid = (L[i] + R[i]) * 0.5;
    kickLp = mid + (kickLp - mid) * aKick;
    const kickAbs = Math.abs(kickLp);
    env += (kickAbs > env ? att : rel) * (kickAbs - env);
    const duck = Math.min(maxDuck, env * amount * 1.6);

    loL = L[i] + (loL - L[i]) * aLo;
    hiL = L[i] + (hiL - L[i]) * aHi;
    loR = R[i] + (loR - R[i]) * aLo;
    hiR = R[i] + (hiR - R[i]) * aHi;
    const bandL = hiL - loL;
    const bandR = hiR - loR;
    outL[i] = L[i] - bandL * duck;
    outR[i] = R[i] - bandR * duck;
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
  // A few percent at most — never fold the image into a muddy center.
  const delta = Math.max(-0.04, Math.min(0.04, (targetMidRatio - cur) * amount * 0.2));
  if (Math.abs(delta) < 0.008) return { L, R };
  const midGain = 1 + delta;
  const sideGain = 1 - delta;

  for (let i = 0; i < L.length; i++) {
    const m = (L[i] + R[i]) * 0.5 * midGain;
    const s = (L[i] - R[i]) * 0.5 * sideGain;
    outL[i] = m + s;
    outR[i] = m - s;
  }
  return { L: outL, R: outR };
}

/** Low-mid vs vocal-mid energy. Higher = muddier. */
function mudRatio(L: Float32Array, R: Float32Array, sr: number): number {
  const n = Math.min(L.length, Math.floor(sr * 40));
  const mid = new Float32Array(n);
  for (let i = 0; i < n; i++) mid[i] = (L[i] + R[i]) * 0.5;
  const lowMid = bandEnergy(mid, sr, 180, 450, n);
  const presence = bandEnergy(mid, sr, 1500, 5000, n);
  return lowMid / (presence + 1e-12);
}

function applyTonalTaste(
  L: Float32Array,
  R: Float32Array,
  sr: number,
  intensity: number,
  character: SonicCharacter
): { L: Float32Array; R: Float32Array; moves: string[] } {
  const moves: string[] = [];
  let outL = new Float32Array(L);
  let outR = new Float32Array(R);
  const soft =
    character === 'minimal' ||
    character === 'moody' ||
    character === 'atmospheric' ||
    character === 'soulful';
  const scale = intensity * (soft ? 0.65 : 0.85);

  const n = Math.min(L.length, Math.floor(sr * 40));
  const mid = new Float32Array(n);
  for (let i = 0; i < n; i++) mid[i] = (L[i] + R[i]) * 0.5;
  const lowMid = bandEnergy(mid, sr, 180, 450, n);
  const body = bandEnergy(mid, sr, 500, 1500, n);
  const presence = bandEnergy(mid, sr, 2000, 5000, n);
  const air = bandEnergy(mid, sr, 8000, 14000, n);
  const vocal = body + presence + 1e-12;

  // Only carve mud when low-mids actually outweigh the vocal band. Never boost subs.
  const mud = lowMid / vocal;
  if (mud > 0.85) {
    const carve = Math.max(-1.15, -0.55 * (mud - 0.7) * scale * 2.2);
    if (carve < -0.2) {
      outL = new Float32Array(processBiquad(outL, calcPeaking(320, carve, 1.35, sr)));
      outR = new Float32Array(processBiquad(outR, calcPeaking(320, carve, 1.35, sr)));
      moves.push(`Clarity carve ${carve.toFixed(1)} dB @320 Hz (no bass boost)`);
    }
  }

  // Open the vocal only when presence is thin relative to the body — small, narrow.
  const presenceRatio = presence / vocal;
  if (presenceRatio < 0.28) {
    const pres = Math.min(0.85, 0.45 * (0.34 - presenceRatio) * 8 * scale);
    if (pres > 0.15) {
      outL = new Float32Array(processBiquad(outL, calcPeaking(3200, pres, 1.15, sr)));
      outR = new Float32Array(processBiquad(outR, calcPeaking(3200, pres, 1.15, sr)));
      moves.push(`Presence +${pres.toFixed(1)} dB`);
    }
  }

  const airRatio = air / vocal;
  if (airRatio < 0.06 && !soft) {
    const airDb = Math.min(0.6, 0.35 * scale);
    outL = new Float32Array(processBiquad(outL, calcHighShelf(12000, airDb, 0.7, sr)));
    outR = new Float32Array(processBiquad(outR, calcHighShelf(12000, airDb, 0.7, sr)));
    moves.push(`Air +${airDb.toFixed(1)} dB`);
  } else if (airRatio > 0.22) {
    const tame = Math.max(-0.7, -0.35 * scale);
    outL = new Float32Array(processBiquad(outL, calcPeaking(5500, tame, 1.5, sr)));
    outR = new Float32Array(processBiquad(outR, calcPeaking(5500, tame, 1.5, sr)));
    moves.push(`Harshness tame ${tame.toFixed(1)} dB @5.5 kHz`);
  }

  if (!moves.length) moves.push('Tonality already balanced — left alone');
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
        g = 1 + 0.018 * intensity;
      } else if (kind === 'verse' || kind === 'bridge' || kind === 'outro') {
        g = 1 - 0.012 * intensity;
      } else if (kind === 'intro') {
        g = 1 - 0.008 * intensity;
      }
      for (let i = start; i < end; i++) curve[i] = g;
    }
    // Smooth transitions ~80ms, then force the curve to average 1.0
    // so verses aren't just turned down.
    const smoothN = Math.floor(sr * 0.08);
    for (let i = 1; i < L.length; i++) {
      const a = Math.min(1, 1 / Math.max(1, smoothN));
      curve[i] = curve[i - 1] + a * (curve[i] - curve[i - 1]);
    }
    let sum = 0;
    for (let i = 0; i < L.length; i++) sum += curve[i];
    const mean = sum / L.length;
    if (mean > 1e-6) {
      for (let i = 0; i < L.length; i++) curve[i] /= mean;
    }
  } else {
    // No sections: tiny chorus-like lift in the middle, averaged to unity.
    for (let i = 0; i < L.length; i++) {
      const t = i / L.length;
      const arc = Math.sin(Math.PI * t);
      curve[i] = 1 + (arc - 0.5) * 0.012 * intensity;
    }
    let sum = 0;
    for (let i = 0; i < L.length; i++) sum += curve[i];
    const mean = sum / L.length;
    if (mean > 1e-6) {
      for (let i = 0; i < L.length; i++) curve[i] /= mean;
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
      ? Math.max(0.2, Math.min(0.7, options.intensity))
      : 0.34 + analysis.traits.energy * 0.12;
  if (soft) intensity *= 0.8;
  intensity = Math.max(0.28, Math.min(0.55, intensity));

  notes.push(
    `Producer Pass · vibe ${analysis.character} · taste intensity ${Math.round(intensity * 100)}%`
  );
  notes.push('Level-matched listens — clarity and pocket only, no bass boost, no loudness drop.');

  let L = new Float32Array(buffer.getChannelData(0));
  let R = new Float32Array(stereo ? buffer.getChannelData(1) : buffer.getChannelData(0));
  const inputRms = signalRms(L, R);
  const inputMud = mudRatio(L, R, sr);

  let metrics = measureCohesion(L, R, sr);
  const startScore = metrics.score;
  notes.push(
    `Listen 1 cohesion ${Math.round(startScore * 100)}% · mud ratio ${inputMud.toFixed(2)}`
  );

  let listensDone = 1;

  const acceptListen = (
    prevL: Float32Array,
    prevR: Float32Array,
    prevMud: number,
    label: string
  ): boolean => {
    const mud = mudRatio(L, R, sr);
    const level = signalRms(L, R);
    const muddier = mud > prevMud * 1.06 && mud > inputMud * 1.04;
    const quieter = level < signalRms(prevL, prevR) * Math.pow(10, -0.45 / 20);
    if (muddier || quieter) {
      L = new Float32Array(prevL);
      R = new Float32Array(prevR);
      notes.push(
        `${label}: kept prior take (${muddier ? 'would have added mud' : 'would have dropped level'}).`
      );
      return false;
    }
    return true;
  };

  // ── Listen 2: clarity / presence — no low-end boost ──────────
  throwIfAborted(signal);
  onProgress?.(22, 'Producer Pass: listen 2 — clarity, not more low end...');
  await yieldToUI();

  {
    const prevL = L;
    const prevR = R;
    const prevMud = mudRatio(L, R, sr);
    const tonal = applyTonalTaste(L, R, sr, intensity, analysis.character);
    L = new Float32Array(tonal.L);
    R = new Float32Array(tonal.R);
    for (const m of tonal.moves) notes.push(`Listen 2: ${m}`);

    const imaged = applyImageTaste(L, R, soft ? 0.58 : 0.62, intensity * 0.5);
    L = new Float32Array(imaged.L);
    R = new Float32Array(imaged.R);

    if (acceptListen(prevL, prevR, prevMud, 'Listen 2')) {
      metrics = measureCohesion(L, R, sr);
      notes.push(`Listen 2 kept · cohesion ${Math.round(metrics.score * 100)}%`);
    } else {
      metrics = measureCohesion(L, R, sr);
    }
    listensDone = 2;
  }

  // ── Listen 3: kick pocket + parallel glue (dry stays up) ─────
  throwIfAborted(signal);
  onProgress?.(48, 'Producer Pass: listen 3 — pocket the kick without dulling...');
  await yieldToUI();

  {
    const prevL = L;
    const prevR = R;
    const prevMud = mudRatio(L, R, sr);
    const before = metrics.score;
    const interplay = applyElementInterplay(L, R, sr, intensity * 0.7);
    L = new Float32Array(interplay.L);
    R = new Float32Array(interplay.R);

    const glueAmt = (soft ? 0.22 : 0.32) * intensity;
    const glued = applyGlue(L, R, sr, glueAmt);
    L = new Float32Array(glued.L);
    R = new Float32Array(glued.R);

    if (acceptListen(prevL, prevR, prevMud, 'Listen 3')) {
      metrics = measureCohesion(L, R, sr);
      notes.push(
        `Listen 3 kept · kick pocket + parallel glue ${(glueAmt * 100).toFixed(0)}% · Δ${((metrics.score - before) * 100).toFixed(1)}`
      );
    }
    listensDone = 3;
  }

  // ── Final listen: arrangement contrast, averaged back to unity ─
  throwIfAborted(signal);
  onProgress?.(72, 'Producer Pass: final listen — contrast without turning it down...');
  await yieldToUI();

  {
    const prevL = L;
    const prevR = R;
    const prevMud = mudRatio(L, R, sr);
    const arr = applyArrangementTaste(L, R, sr, sections, intensity * 0.85);
    L = new Float32Array(arr.L);
    R = new Float32Array(arr.R);
    if (acceptListen(prevL, prevR, prevMud, 'Final listen')) {
      notes.push(`Final listen: ${arr.note} (average level unchanged)`);
    }
    listensDone = 4;
  }

  const matched = matchRms(L, R, inputRms);
  // Headroom for the master — only pull peaks that would clip, never a blanket cut.
  normalizePeak(L, R, 0.98);
  const outRms = signalRms(L, R);
  const levelDb = 20 * Math.log10((outRms + 1e-12) / (inputRms + 1e-12));
  const outMud = mudRatio(L, R, sr);
  metrics = measureCohesion(L, R, sr);

  await yieldToUI();
  onProgress?.(100, 'Producer Pass complete');

  notes.push(
    `Level ${levelDb >= 0 ? '+' : ''}${levelDb.toFixed(2)} dB vs input` +
      (Math.abs(matched - 1) > 0.01 ? ` (restored ×${matched.toFixed(3)})` : '')
  );
  notes.push(
    `Mud ratio ${inputMud.toFixed(2)} → ${outMud.toFixed(2)} · cohesion ${Math.round(startScore * 100)}% → ${Math.round(metrics.score * 100)}%`
  );
  notes.push('Four producer listens — clarity and pocket only, loudness handed back to the master.');

  return {
    buffer: createBuffer(L, R, sr, stereo),
    notes,
    listens: listensDone,
    cohesionScore: metrics.score,
    character: analysis.character,
  };
}
