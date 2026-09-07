/**
 * Smart Enhance — analysis-driven stereo production upgrade.
 *
 * Uses sonic-character detection (energy, density, brightness, warmth,
 * dynamics, low-end weight) to choose how aggressively to polish a mix.
 * Slow/moody/minimal material gets gentle treatment; energetic/anthemic
 * material gets more punch and competitive density.
 *
 * Not a neural net — browser-safe DSP guided by measured traits.
 * Cannot invent instruments or rewrite composition; upgrades clarity,
 * punch, musical energy, and delivery polish on the stereo bus.
 */

import { SongSection } from '@/types/audio';
import { PipelineDiagnosis } from '@/lib/pipeline-analyze';
import {
  CharacterAnalysis,
  SonicCharacter,
  detectSonicCharacter,
} from '@/lib/sonic-character';

export interface SmartEnhanceResult {
  buffer: AudioBuffer;
  notes: string[];
  character: SonicCharacter;
  confidence: number;
  intensity: number;
}

export interface SmartEnhanceOptions {
  onProgress?: (p: number, m: string) => void;
  /** User override 0–1; if omitted, intensity is derived from analysis */
  intensity?: number;
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

function calcLowShelf(freq: number, gain: number, Q: number, sr: number): BiquadCoeffs {
  const A = Math.pow(10, gain / 40);
  const w0 = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const cosW = Math.cos(w0);
  const sqrtA = Math.sqrt(A);
  const b0 = A * (A + 1 - (A - 1) * cosW + 2 * sqrtA * alpha);
  const b1 = 2 * A * (A - 1 - (A + 1) * cosW);
  const b2 = A * (A + 1 - (A - 1) * cosW - 2 * sqrtA * alpha);
  const a0 = A + 1 + (A - 1) * cosW + 2 * sqrtA * alpha;
  const a1 = -2 * (A - 1 + (A + 1) * cosW);
  const a2 = A + 1 + (A - 1) * cosW - 2 * sqrtA * alpha;
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

function compress(
  data: Float32Array,
  sr: number,
  threshold: number,
  ratio: number,
  attack: number,
  release: number,
  makeupDb: number
): Float32Array {
  const out = new Float32Array(data.length);
  const att = 1 - Math.exp(-1 / (sr * attack));
  const rel = 1 - Math.exp(-1 / (sr * release));
  const makeup = Math.pow(10, makeupDb / 20);
  let env = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    env += (abs > env ? att : rel) * (abs - env);
    let gain = 1;
    if (env > 1e-8) {
      const envDb = 20 * Math.log10(env);
      if (envDb > threshold) {
        const over = envDb - threshold;
        gain = Math.pow(10, (over / ratio - over) / 20);
      }
    }
    out[i] = data[i] * gain * makeup;
  }
  return out;
}

function enhanceTransients(data: Float32Array, sr: number, amountDb: number): Float32Array {
  if (amountDb <= 0.05) return data;
  const out = new Float32Array(data.length);
  const fastA = 1 - Math.exp(-1 / (sr * 0.0004));
  const fastR = 1 - Math.exp(-1 / (sr * 0.008));
  const slowA = 1 - Math.exp(-1 / (sr * 0.025));
  const slowR = 1 - Math.exp(-1 / (sr * 0.18));
  let fast = 0,
    slow = 0;
  const boostLin = Math.pow(10, amountDb / 20);
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    fast += (abs > fast ? fastA : fastR) * (abs - fast);
    slow += (abs > slow ? slowA : slowR) * (abs - slow);
    let boost = 1;
    if (slow > 1e-5) {
      const ratio = fast / slow;
      if (ratio > 1.05) {
        const depth = Math.min(1, (ratio - 1.05) * 1.8);
        boost = 1 + (boostLin - 1) * depth;
      }
    }
    out[i] = data[i] * boost;
  }
  return out;
}

function smoothBlocks(blocks: Float32Array, radius: number): Float32Array {
  if (radius < 1) return blocks;
  const out = new Float32Array(blocks.length);
  for (let i = 0; i < blocks.length; i++) {
    let sum = 0,
      n = 0;
    const a = Math.max(0, i - radius);
    const b = Math.min(blocks.length - 1, i + radius);
    for (let j = a; j <= b; j++) {
      sum += blocks[j];
      n++;
    }
    out[i] = sum / (n || 1);
  }
  return out;
}

/**
 * Build a per-sample gain curve WITHOUT O(n × radius) smoothing.
 * Work in ~20 ms blocks (thousands of points, not millions), then
 * linearly interpolate when applying — keeps real MP3s responsive.
 */
function buildSectionGainCurve(
  length: number,
  sr: number,
  sections: SongSection[],
  arcScale: number
): Float32Array {
  const curve = new Float32Array(length);
  curve.fill(1);
  if (arcScale < 0.08) return curve;

  const hop = Math.max(1, Math.floor(sr * 0.02)); // 20 ms
  const nBlocks = Math.ceil(length / hop);
  let blocks = new Float32Array(nBlocks);
  blocks.fill(1);

  if (!sections.length) {
    const mid = (nBlocks - 1) / 2;
    const half = nBlocks * 0.4;
    for (let b = 0; b < nBlocks; b++) {
      const d = Math.abs(b - mid) / Math.max(1, half);
      const shape = Math.max(0, 1 - d * d);
      blocks[b] = Math.pow(10, (arcScale * 0.9 * shape) / 20);
    }
  } else {
    const kindDb: Record<string, number> = {
      intro: -1.0 * arcScale,
      verse: -0.45 * arcScale,
      bridge: -0.15 * arcScale,
      chorus: 1.5 * arcScale,
      outro: -0.7 * arcScale,
      custom: 0.25 * arcScale,
    };
    for (const s of sections) {
      const startB = Math.max(0, Math.floor((s.start * sr) / hop));
      const endB = Math.min(nBlocks, Math.ceil((s.end * sr) / hop));
      const db = kindDb[s.kind] ?? 0;
      if (Math.abs(db) < 0.04) continue;
      const g = Math.pow(10, db / 20);
      for (let b = startB; b < endB; b++) blocks[b] = g;
    }
  }

  // Smooth ~160 ms of blocks (8 × 20 ms) — O(blocks), not O(samples)
  const smoothed = smoothBlocks(blocks, 8);

  for (let i = 0; i < length; i++) {
    const pos = i / hop;
    const b0 = Math.min(nBlocks - 1, pos | 0);
    const b1 = Math.min(nBlocks - 1, b0 + 1);
    const t = pos - b0;
    curve[i] = smoothed[b0] * (1 - t) + smoothed[b1] * t;
  }
  return curve;
}

/** Character → recipe multipliers (0–1 scales applied to base moves). */
function recipeFor(character: SonicCharacter, traits: CharacterAnalysis['traits']) {
  // Soft / intimate families
  const soft =
    character === 'minimal' ||
    character === 'moody' ||
    character === 'atmospheric' ||
    character === 'soulful';

  const hard =
    character === 'aggressive' ||
    character === 'anthemic' ||
    character === 'hitmaker' ||
    character === 'gospel';

  return {
    mudCut: soft ? 0.55 : hard ? 1.0 : 0.8,
    punch: soft ? 0.25 : hard ? 1.0 : 0.55 + traits.transientHardness * 0.35,
    density: soft ? 0.2 : hard ? 0.95 : 0.45 + traits.density * 0.3,
    arc: soft ? 0.35 : hard ? 0.95 : 0.55 + traits.energy * 0.3,
    presence: soft ? 0.45 : hard ? 0.9 : 0.6 + (1 - traits.brightness) * 0.25,
    air: soft ? 0.4 : hard ? 0.85 : 0.55,
    warmth: soft ? 0.7 : hard ? 0.25 : 0.4 + traits.warmth * 0.3,
    lowShelf: soft ? 0.35 : hard ? 0.7 : 0.4 + traits.lowEndWeight * 0.25,
    /** Streaming target bias: softer stays quieter; hits go more competitive */
    lufsBias: soft ? -13.5 : hard ? -11.5 : -12.5,
  };
}

/** Derive overall intensity from analysis when user doesn't override. */
export function intensityFromAnalysis(analysis: CharacterAnalysis): number {
  const t = analysis.traits;
  // High dynamics + low energy → ballad-ish → keep gentle
  // High energy + hard transients → more intensity
  let i =
    0.35 +
    t.energy * 0.35 +
    t.transientHardness * 0.2 +
    (1 - t.dynamicRange) * 0.15;
  if (
    analysis.character === 'minimal' ||
    analysis.character === 'moody' ||
    analysis.character === 'atmospheric'
  ) {
    i *= 0.65;
  }
  if (analysis.character === 'aggressive' || analysis.character === 'hitmaker') {
    i = Math.max(i, 0.72);
  }
  return Math.max(0.28, Math.min(0.92, i));
}

function createBuffer(L: Float32Array, R: Float32Array, sr: number, stereo: boolean): AudioBuffer {
  const ctx = new OfflineAudioContext(stereo ? 2 : 1, L.length, sr);
  const buf = ctx.createBuffer(stereo ? 2 : 1, L.length, sr);
  buf.copyToChannel(new Float32Array(L), 0);
  if (stereo) buf.copyToChannel(new Float32Array(R), 1);
  return buf;
}

export async function applySmartEnhance(
  buffer: AudioBuffer,
  sections: SongSection[],
  diagnosis: PipelineDiagnosis,
  options: SmartEnhanceOptions = {}
): Promise<SmartEnhanceResult> {
  const { onProgress } = options;
  const notes: string[] = [];
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const stereo = buffer.numberOfChannels >= 2;

  onProgress?.(4, 'Smart Enhance: listening to the track...');
  await new Promise((r) => setTimeout(r, 0));

  const analysis = detectSonicCharacter(buffer);
  const recipe = recipeFor(analysis.character, analysis.traits);
  const I =
    typeof options.intensity === 'number'
      ? Math.max(0.25, Math.min(1, options.intensity))
      : intensityFromAnalysis(analysis);

  notes.push(
    `Detected vibe: ${analysis.character} (${Math.round(analysis.confidence * 100)}% confidence)`
  );
  notes.push(`Adaptive intensity ${(I * 100).toFixed(0)}% for this material`);

  let L = new Float32Array(buffer.getChannelData(0));
  let R = new Float32Array(stereo ? buffer.getChannelData(1) : buffer.getChannelData(0));

  onProgress?.(18, `Smart Enhance: ${analysis.character} cleanup...`);
  await new Promise((r) => setTimeout(r, 0));

  const mudBase = diagnosis.mudRatio > 0.35 ? -2.8 : -1.8;
  const mudAmount = mudBase * recipe.mudCut * I;
  L = new Float32Array(processBiquad(L, calcHighpass(30, 0.707, sr)));
  R = new Float32Array(processBiquad(R, calcHighpass(30, 0.707, sr)));
  L = new Float32Array(processBiquad(L, calcPeaking(300, mudAmount, 0.9, sr)));
  R = new Float32Array(processBiquad(R, calcPeaking(300, mudAmount, 0.9, sr)));
  if (diagnosis.mudRatio > 0.28 || analysis.traits.warmth > 0.65) {
    const box = -1.1 * recipe.mudCut * I;
    L = new Float32Array(processBiquad(L, calcPeaking(480, box, 1.5, sr)));
    R = new Float32Array(processBiquad(R, calcPeaking(480, box, 1.5, sr)));
  }
  notes.push(`Clarity EQ adapted to ${analysis.character} (${mudAmount.toFixed(1)} dB mud)`);

  onProgress?.(40, 'Smart Enhance: dynamics & punch...');
  await new Promise((r) => setTimeout(r, 0));

  const punchDb = 2.0 * recipe.punch * I;
  if (punchDb > 0.2) {
    L = new Float32Array(enhanceTransients(L, sr, punchDb));
    R = new Float32Array(enhanceTransients(R, sr, punchDb));
    notes.push(`Transient punch +${punchDb.toFixed(1)} dB`);
  } else {
    notes.push('Transient punch skipped (soft/intimate material)');
  }

  const wetMix = (0.1 + recipe.density * 0.22) * I;
  if (wetMix > 0.06) {
    const paraL = compress(L, sr, -20, 2.8 + recipe.density, 0.015, 0.14, 1.8 * recipe.density);
    const paraR = compress(R, sr, -20, 2.8 + recipe.density, 0.015, 0.14, 1.8 * recipe.density);
    for (let i = 0; i < len; i++) {
      L[i] = L[i] * (1 - wetMix) + paraL[i] * wetMix;
      R[i] = R[i] * (1 - wetMix) + paraR[i] * wetMix;
    }
    notes.push(`Parallel density ${(wetMix * 100).toFixed(0)}% (${analysis.character})`);
  }

  onProgress?.(62, 'Smart Enhance: musical shape...');
  await new Promise((r) => setTimeout(r, 0));

  const arcScale = recipe.arc * I;
  const gainCurve = buildSectionGainCurve(len, sr, sections, arcScale);
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < len; i++) {
    L[i] *= gainCurve[i];
    R[i] *= gainCurve[i];
  }
  notes.push(
    sections.length
      ? `Section energy arc ×${arcScale.toFixed(2)} (${sections.length} parts)`
      : `Gentle energy shape ×${arcScale.toFixed(2)}`
  );

  onProgress?.(78, 'Smart Enhance: tone polish...');
  await new Promise((r) => setTimeout(r, 0));

  if (recipe.warmth * I > 0.25) {
    const warmDb = 0.9 * recipe.warmth * I;
    L = new Float32Array(processBiquad(L, calcLowShelf(180, warmDb, 0.7, sr)));
    R = new Float32Array(processBiquad(R, calcLowShelf(180, warmDb, 0.7, sr)));
    notes.push(`Warmth shelf +${warmDb.toFixed(1)} dB`);
  }
  if (recipe.lowShelf * I > 0.2 && analysis.traits.lowEndWeight < 0.55) {
    const lowDb = 0.8 * recipe.lowShelf * I;
    L = new Float32Array(processBiquad(L, calcLowShelf(90, lowDb, 0.7, sr)));
    R = new Float32Array(processBiquad(R, calcLowShelf(90, lowDb, 0.7, sr)));
  }

  const presDb = 1.5 * recipe.presence * I;
  L = new Float32Array(processBiquad(L, calcPeaking(2800, presDb, 1.3, sr)));
  R = new Float32Array(processBiquad(R, calcPeaking(2800, presDb, 1.3, sr)));
  const airDb = 1.2 * recipe.air * I;
  L = new Float32Array(processBiquad(L, calcHighShelf(11000, airDb, 0.6, sr)));
  R = new Float32Array(processBiquad(R, calcHighShelf(11000, airDb, 0.6, sr)));
  notes.push(`Presence +${presDb.toFixed(1)} · air +${airDb.toFixed(1)}`);

  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  if (peak > 0.89) {
    const g = 0.89 / peak;
    for (let i = 0; i < len; i++) {
      L[i] *= g;
      R[i] *= g;
    }
  }

  notes.push('Adaptive enhance — guided by measured traits, not a fixed genre template.');

  onProgress?.(100, 'Smart Enhance complete');
  return {
    buffer: createBuffer(L, R, sr, stereo),
    notes,
    character: analysis.character,
    confidence: analysis.confidence,
    intensity: I,
  };
}

/** @deprecated use applySmartEnhance */
export const applyHitMaker = applySmartEnhance;

export function smartEnhanceMasteringBoost(
  base: {
    targetLUFS: number;
    truePeakCeiling: number;
    multibandAggression: number;
    stereoWidenAmount: number;
    harmonicExcitement: number;
    lowEndBoost: number;
    airBoost: number;
    busCompGlue: number;
    analogWarmth: number;
  },
  character: SonicCharacter,
  intensity: number
) {
  const recipe = recipeFor(character, {
    energy: intensity,
    density: intensity,
    brightness: 0.5,
    warmth: 0.5,
    spaciousness: 0.5,
    transientHardness: intensity,
    dynamicRange: 1 - intensity,
    lowEndWeight: 0.5,
  });

  return {
    ...base,
    targetLUFS: recipe.lufsBias,
    truePeakCeiling: Math.min(base.truePeakCeiling, -1),
    multibandAggression: Math.min(0.7, base.multibandAggression * (0.8 + intensity * 0.5)),
    stereoWidenAmount: Math.min(0.65, base.stereoWidenAmount * (0.85 + recipe.air * 0.4)),
    harmonicExcitement: Math.min(0.4, base.harmonicExcitement * 0.8 + recipe.warmth * 0.15 * intensity),
    airBoost: Math.min(2.0, base.airBoost + recipe.air * 0.4 * intensity),
    busCompGlue: Math.min(0.65, base.busCompGlue * (0.85 + recipe.density * 0.4)),
    lowEndBoost: Math.min(1.6, base.lowEndBoost + recipe.lowShelf * 0.3 * intensity),
    analogWarmth: Math.min(0.55, base.analogWarmth + recipe.warmth * 0.25 * intensity),
  };
}

/** @deprecated use smartEnhanceMasteringBoost */
export const hitMakerMasteringBoost = (
  base: Parameters<typeof smartEnhanceMasteringBoost>[0]
) => smartEnhanceMasteringBoost(base, 'hitmaker', 0.75);
