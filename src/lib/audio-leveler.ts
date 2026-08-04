// ─── Audio Levelling Station ─────────────────────────────────────
// Gain staging / healthy levels only — not mastering.
// Based on iZotope, LANDR, Sound On Sound, and Mastering.com guidance:
//   • Nominal average ≈ −18 dBFS (0 VU calibration)
//   • Peak headroom ≈ −6 dBFS for mix prep (−3 dBFS minimum)
//   • Never normalize to 0 dBFS (LANDR)
//   • Loudness mode uses gated RMS approximation for listenability
//   • Optional light crest evening for uneven material (vocals/dynamics)
//
// Fully offline, client-side, no external deps.

export type LevelingMode = 'mix' | 'loudness' | 'peak';

export interface LevelingAnalysis {
  peakDb: number;
  rmsDb: number;
  crestFactor: number;
  estimatedLUFS: number;
  isClipping: boolean;
  headroomDb: number;
}

export interface LevelingResult {
  buffer: AudioBuffer;
  analysisBefore: LevelingAnalysis;
  analysisAfter: LevelingAnalysis;
  gainAppliedDb: number;
  mode: LevelingMode;
  recommendations: string[];
}

export interface LevelingOptions {
  mode?: LevelingMode;
  /** Target RMS for 'mix' mode (default −18 dBFS = 0 VU). */
  targetRmsDb?: number;
  /** Target estimated LUFS for 'loudness' mode (default −16, rough-mix listen level). */
  targetLufs?: number;
  /** Peak ceiling for 'peak' mode (default −3 dBFS — never 0). */
  peakCeilingDb?: number;
  /** Absolute peak safety after gain (default −6 for mix, −3 for loudness/peak). */
  maxPeakDb?: number;
  /** Light crest evening when material is very dynamic (default true for mix). */
  evenDynamics?: boolean;
}

function toDb(linear: number): number {
  return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
}

function getPeak(buffer: AudioBuffer): number {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

function getRMS(buffer: AudioBuffer): number {
  let sum = 0;
  let count = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
      count++;
    }
  }
  return Math.sqrt(sum / Math.max(1, count));
}

/** Gated loudness approximation for levelling decisions (not a master meter). */
function estimateLUFS(buffer: AudioBuffer): number {
  const sr = buffer.sampleRate;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const len = Math.min(L.length, sr * 45);
  const blockSize = Math.round(sr * 0.4);
  const hop = Math.round(sr * 0.1);
  const blocks: number[] = [];

  for (let start = 0; start + blockSize <= len; start += hop) {
    let ms = 0;
    for (let i = start; i < start + blockSize; i++) {
      const s = (L[i] + R[i]) * 0.5;
      ms += s * s;
    }
    blocks.push(ms / blockSize);
  }

  if (blocks.length === 0) return toDb(getRMS(buffer)) - 0.691;

  const absThresh = Math.pow(10, (-70 + 0.691) / 10);
  let absSum = 0;
  let absCount = 0;
  for (const b of blocks) {
    if (b > absThresh) {
      absSum += b;
      absCount++;
    }
  }
  if (absCount === 0) return -70;
  const absMean = absSum / absCount;
  const relThresh = absMean * 0.1;
  let relSum = 0;
  let relCount = 0;
  for (const b of blocks) {
    if (b > absThresh && b > relThresh) {
      relSum += b;
      relCount++;
    }
  }
  if (relCount === 0) return -70;
  return -0.691 + 10 * Math.log10(relSum / relCount);
}

function analyzeBuffer(buffer: AudioBuffer): LevelingAnalysis {
  const peak = getPeak(buffer);
  const rms = getRMS(buffer);
  const peakDb = toDb(peak);
  const rmsDb = toDb(rms);
  return {
    peakDb,
    rmsDb,
    crestFactor: peakDb - rmsDb,
    estimatedLUFS: estimateLUFS(buffer),
    isClipping: peak >= 0.999,
    headroomDb: 0 - peakDb,
  };
}

function createBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const ctx = new OfflineAudioContext(channels.length, channels[0].length, sampleRate);
  const buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
  for (let ch = 0; ch < channels.length; ch++) {
    buf.copyToChannel(new Float32Array(channels[ch]), ch);
  }
  return buf;
}

/**
 * Very light upward gain on quiet moments only — not a compressor for tone.
 * Keeps crest more usable for listening without destroying dynamics
 * (Sound On Sound vocal levelling / clip-gain spirit).
 */
function lightCrestEven(
  data: Float32Array,
  sr: number,
  amount: number
): Float32Array {
  if (amount <= 0.01) return data;
  const out = new Float32Array(data.length);
  const attack = 1 - Math.exp(-1 / (sr * 0.005));
  const release = 1 - Math.exp(-1 / (sr * 0.08));
  let env = 0;
  const floor = Math.pow(10, -28 / 20);
  const ceil = Math.pow(10, -12 / 20);
  const maxBoost = Math.pow(10, (amount * 4) / 20); // up to ~+4 dB

  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    env += (abs > env ? attack : release) * (abs - env);
    let gain = 1;
    if (env > floor && env < ceil) {
      const t = (ceil - env) / (ceil - floor);
      gain = 1 + (maxBoost - 1) * t * t;
    }
    out[i] = data[i] * gain;
  }
  return out;
}

function applyGain(buffer: AudioBuffer, gainDb: number): AudioBuffer {
  const g = Math.pow(10, gainDb / 20);
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = src[i] * g;
    channels.push(out);
  }
  return createBuffer(channels, buffer.sampleRate);
}

function softCeiling(buffer: AudioBuffer, ceilingDb: number): AudioBuffer {
  const ceiling = Math.pow(10, ceilingDb / 20);
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) {
      const x = src[i];
      const a = Math.abs(x);
      if (a <= ceiling) out[i] = x;
      else out[i] = Math.sign(x) * (ceiling + (a - ceiling) / (1 + (a - ceiling) * 4));
    }
    channels.push(out);
  }
  return createBuffer(channels, buffer.sampleRate);
}

function buildRecommendations(
  before: LevelingAnalysis,
  after: LevelingAnalysis,
  gainDb: number,
  mode: LevelingMode
): string[] {
  const recs: string[] = [];

  if (before.isClipping) {
    recs.push('Source was clipping at 0 dBFS — level pulled down to restore headroom.');
  } else if (before.peakDb > -3) {
    recs.push('Peaks were too hot for healthy gain staging — trimmed toward mix-safe headroom.');
  } else if (before.rmsDb < -28) {
    recs.push('Source was very quiet — raised toward a usable listening / mixing level.');
  }

  if (mode === 'mix') {
    recs.push('Mix mode targets ≈ −18 dBFS average (0 VU) with ≈ −6 dBFS peak headroom.');
  } else if (mode === 'loudness') {
    recs.push('Loudness mode aims for a balanced listening level without mastering limiting.');
  } else {
    recs.push('Peak mode raises the highest peak to a safe ceiling — never to 0 dBFS.');
  }

  if (Math.abs(gainDb) < 0.25) {
    recs.push('Levels were already healthy — only fine trim applied.');
  } else {
    recs.push(
      `Applied ${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB clip-style gain. After: peak ${after.peakDb.toFixed(1)} dBFS, RMS ${after.rmsDb.toFixed(1)} dBFS.`
    );
  }

  if (after.crestFactor > 18) {
    recs.push('Still very dynamic — consider light automation or compression later if needed.');
  } else if (after.crestFactor < 6) {
    recs.push('Dynamic range is already tight — avoided heavy further squashing.');
  }

  return recs;
}

/**
 * Auto-level a stereo (or mono) track to healthy digital gain-staging levels.
 */
export async function autoLevelTrack(
  buffer: AudioBuffer,
  options: LevelingOptions = {},
  onProgress?: (progress: number, message: string) => void
): Promise<LevelingResult> {
  const mode: LevelingMode = options.mode ?? 'mix';
  const targetRms = options.targetRmsDb ?? -18;
  const targetLufs = options.targetLufs ?? -16;
  const peakCeiling = options.peakCeilingDb ?? -3;
  const evenDynamics = options.evenDynamics ?? mode === 'mix';

  onProgress?.(8, 'Measuring levels...');
  await new Promise((r) => setTimeout(r, 0));
  const analysisBefore = analyzeBuffer(buffer);

  onProgress?.(25, 'Calculating gain staging...');
  await new Promise((r) => setTimeout(r, 0));

  let gainDb = 0;
  let maxPeak = options.maxPeakDb ?? (mode === 'mix' ? -6 : -3);

  if (mode === 'mix') {
    // VU-style average targeting (iZotope / Mastering.com)
    gainDb = targetRms - analysisBefore.rmsDb;
  } else if (mode === 'loudness') {
    gainDb = targetLufs - analysisBefore.estimatedLUFS;
    if (!isFinite(gainDb)) gainDb = targetRms - analysisBefore.rmsDb;
  } else {
    // Peak normalize to safe ceiling (LANDR: not 0 dBFS)
    gainDb = peakCeiling - analysisBefore.peakDb;
  }

  // Cap so projected peak respects headroom
  if (isFinite(analysisBefore.peakDb)) {
    const projectedPeak = analysisBefore.peakDb + gainDb;
    if (projectedPeak > maxPeak) {
      gainDb -= projectedPeak - maxPeak;
    }
  }

  // Don't explode silence / noise-floor tracks
  gainDb = Math.max(-24, Math.min(24, gainDb));

  onProgress?.(45, `Applying ${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB...`);
  await new Promise((r) => setTimeout(r, 0));

  let out = applyGain(buffer, gainDb);

  // Crest evening for very dynamic sources (clip-gain spirit)
  if (evenDynamics && analysisBefore.crestFactor > 14 && mode !== 'peak') {
    onProgress?.(65, 'Evening uneven dynamics...');
    await new Promise((r) => setTimeout(r, 0));
    const amount = Math.min(1, (analysisBefore.crestFactor - 14) / 10);
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      channels.push(lightCrestEven(new Float32Array(out.getChannelData(ch)), out.sampleRate, amount * 0.55));
    }
    out = createBuffer(channels, out.sampleRate);

    // Re-trim peak after light even
    const mid = analyzeBuffer(out);
    if (mid.peakDb > maxPeak) {
      out = applyGain(out, maxPeak - mid.peakDb);
      gainDb += maxPeak - mid.peakDb;
    }
  }

  onProgress?.(85, 'Safety ceiling...');
  await new Promise((r) => setTimeout(r, 0));
  out = softCeiling(out, Math.min(maxPeak + 0.5, -0.5));

  const analysisAfter = analyzeBuffer(out);
  const recommendations = buildRecommendations(analysisBefore, analysisAfter, gainDb, mode);

  onProgress?.(100, 'Levelling complete!');

  return {
    buffer: out,
    analysisBefore,
    analysisAfter,
    gainAppliedDb: gainDb,
    mode,
    recommendations,
  };
}
