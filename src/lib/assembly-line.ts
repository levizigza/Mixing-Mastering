/** Diagnosis-weighted stereo cleanup before mastering (no destructive stem remaster). */

import { SongSection } from '@/types/audio';
import { analyzePipeline, PipelineDiagnosis, PipelineIssue } from '@/lib/pipeline-analyze';
import { runAudioRepair, RepairSettings } from '@/lib/audio-repair';
import { autoLevelTrack } from '@/lib/audio-leveler';
import { analyzeAndMasterTrack } from '@/lib/auto-mix';
import { applyMasteringChain } from '@/lib/mastering-chain';
import { detectSonicCharacter, getProcessingProfile } from '@/lib/sonic-character';
import { applySmartEnhance, smartEnhanceMasteringBoost } from '@/lib/hit-maker';
import { runAutotuneStation } from '@/lib/autotune-station';
import { applyResonanceCleanup } from '@/lib/resonance-eq';
import { applyVocalPocket } from '@/lib/vocal-pocket';
import { getStreamingTarget, StreamingPlatformId } from '@/lib/streaming-targets';
import type { SonicCharacter } from '@/lib/sonic-character';

export type AssemblyStageId =
  | 'analyze'
  | 'repair'
  | 'resonance'
  | 'fix'
  | 'level'
  | 'pocket'
  | 'tune'
  | 'hit'
  | 'master'
  | 'deliver'
  | 'done';

export const ASSEMBLY_STAGE_LABELS: Record<AssemblyStageId, string> = {
  analyze: 'Analyze',
  repair: 'Repair',
  resonance: 'Resonance',
  fix: 'Correct',
  level: 'Level',
  pocket: 'Vocal Pocket',
  tune: 'Studio Tune',
  hit: 'Smart Enhance',
  master: 'Master',
  deliver: 'Deliver',
  done: 'Done',
};

/** Natural/Studio Auto-Tune intensity for the full pipeline (not T-Pain). */
const ASSEMBLY_STUDIO_TUNE_INTENSITY = 28;

export interface AssemblyStageNote {
  stage: AssemblyStageId;
  label: string;
  notes: string[];
}

/** Lightweight report for React state — no AudioBuffers. */
export interface AssemblyLineReportData {
  sections: SongSection[];
  diagnosis: PipelineDiagnosis;
  stageNotes: AssemblyStageNote[];
  trackAnalysisNotes: string[];
  finalLUFS: number;
  truePeak: number;
  bpm: number;
  sectionCount: number;
  /** Streaming target used for the master */
  streamingTarget?: string;
  streamingLUFS?: number;
}

export interface AssemblyLineResult {
  originalBuffer: AudioBuffer;
  finalBuffer: AudioBuffer;
  report: AssemblyLineReportData;
}

export interface AssemblyLineOptions {
  onProgress?: (pct: number, stageId: AssemblyStageId, message: string) => void;
  signal?: AbortSignal;
  trackName?: string;
  /** Fallback if no streamingTarget — default −14 */
  targetLUFS?: number;
  /** Streaming / social loudness target (drives master LUFS + true peak) */
  streamingTarget?: StreamingPlatformId;
  /** Analysis-driven adaptive polish (genre/vibe aware) */
  hitMaker?: boolean;
  hitMakerIntensity?: number;
  /**
   * Natural studio pitch polish (default true).
   * Transparent Retune-style correction — not hard / T-Pain Auto-Tune.
   */
  studioTune?: boolean;
  /** Surgical resonance notches (default true) */
  resonanceCleanup?: boolean;
  /** Center vocal ride + pocket carve (default true) */
  vocalPocket?: boolean;
}

function createMonoBuffer(data: Float32Array, sampleRate: number): AudioBuffer {
  const ctx = new OfflineAudioContext(1, data.length, sampleRate);
  const buf = ctx.createBuffer(1, data.length, sampleRate);
  buf.copyToChannel(new Float32Array(data), 0);
  return buf;
}

function createStereoBuffer(L: Float32Array, R: Float32Array, sampleRate: number): AudioBuffer {
  const ctx = new OfflineAudioContext(2, L.length, sampleRate);
  const buf = ctx.createBuffer(2, L.length, sampleRate);
  buf.copyToChannel(new Float32Array(L), 0);
  buf.copyToChannel(new Float32Array(R), 1);
  return buf;
}

/**
 * Studio pitch polish for full mixes: correct the mid (center) channel where
 * vocals live, leave sides alone so stereo instruments keep their width.
 * Intensity stays in the Natural→Studio range — vibrato & slides preserved.
 */
async function applyAssemblyStudioTune(
  buffer: AudioBuffer,
  onProgress?: (p: number, m: string) => void
): Promise<{ buffer: AudioBuffer; notes: string[] }> {
  const wet = 0.82; // slight dry blend keeps full-mix natural

  if (buffer.numberOfChannels < 2) {
    const result = await runAutotuneStation(buffer, ASSEMBLY_STUDIO_TUNE_INTENSITY, onProgress);
    return {
      buffer: result.buffer,
      notes: [
        ...result.notes,
        'Studio Tune: natural pitch polish (mono).',
      ],
    };
  }

  onProgress?.(4, 'Studio Tune: splitting mid / side...');
  await yieldToUI();

  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);
  const len = buffer.length;
  const mid = new Float32Array(len);
  const side = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    mid[i] = (L[i] + R[i]) * 0.5;
    side[i] = (L[i] - R[i]) * 0.5;
  }

  const midBuf = createMonoBuffer(mid, buffer.sampleRate);
  const result = await runAutotuneStation(
    midBuf,
    ASSEMBLY_STUDIO_TUNE_INTENSITY,
    (p, m) => onProgress?.(8 + Math.round(p * 0.86), m)
  );

  onProgress?.(96, 'Studio Tune: blending center...');
  await yieldToUI();

  const tunedMid = result.buffer.getChannelData(0);
  const outL = new Float32Array(len);
  const outR = new Float32Array(len);
  const dry = 1 - wet;
  for (let i = 0; i < len; i++) {
    const m = mid[i] * dry + tunedMid[i] * wet;
    outL[i] = m + side[i];
    outR[i] = m - side[i];
  }

  return {
    buffer: createStereoBuffer(outL, outR, buffer.sampleRate),
    notes: [
      ...result.notes,
      'Center-channel studio pitch (sides preserved).',
      'Natural/Studio intensity — vibrato & slides kept, not hard Auto-Tune.',
    ],
  };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const err = new Error('Assembly line cancelled');
    err.name = 'AbortError';
    throw err;
  }
}

async function yieldToUI() {
  await new Promise<void>((r) => setTimeout(r, 0));
}

function mapProgress(
  onProgress: AssemblyLineOptions['onProgress'],
  stage: AssemblyStageId,
  base: number,
  span: number
) {
  return (p: number, m: string) => {
    const pct = Math.min(99, Math.round(base + (p / 100) * span));
    onProgress?.(pct, stage, m);
  };
}

function hasIssue(issues: PipelineIssue[], id: string, min: 'low' | 'medium' | 'high' = 'low') {
  const order = { low: 1, medium: 2, high: 3 };
  const hit = issues.find((i) => i.id === id);
  if (!hit) return false;
  return order[hit.severity] >= order[min];
}

function repairFromDiagnosis(d: PipelineDiagnosis): RepairSettings {
  const s = { ...d.repairSettings };
  // Full cleanup on every track length — quality first (repair yields keep UI alive)
  if (hasIssue(d.issues, 'noiseFloor', 'low')) s.denoise = Math.max(s.denoise, 48);
  if (hasIssue(d.issues, 'clipping', 'medium')) s.declip = Math.max(s.declip, 60);
  if (hasIssue(d.issues, 'clipping', 'high')) s.declip = 75;
  s.declick = Math.max(s.declick, 40);
  s.dehum = Math.max(s.dehum, 35);
  if (hasIssue(d.issues, 'mud', 'medium')) {
    s.deplosive = Math.max(s.deplosive, 45);
    s.dereverb = Math.max(s.dereverb, 28);
  }
  return s;
}

/** Offline biquad corrective EQ driven by diagnosis flags. */
async function applyCorrectiveEq(
  buffer: AudioBuffer,
  diagnosis: PipelineDiagnosis,
  onProgress?: (p: number, m: string) => void
): Promise<{ buffer: AudioBuffer; notes: string[] }> {
  const notes: string[] = [];
  const filters: { type: BiquadFilterType; frequency: number; Q: number; gain: number }[] = [];

  if (hasIssue(diagnosis.issues, 'mud', 'low')) {
    const gain = hasIssue(diagnosis.issues, 'mud', 'high') ? -3.5 : -2.2;
    filters.push({ type: 'peaking', frequency: 280, Q: 1.1, gain });
    filters.push({ type: 'highpass', frequency: 35, Q: 0.7, gain: 0 });
    notes.push(`Cut mud ~280 Hz (${gain} dB)`);
  }
  if (hasIssue(diagnosis.issues, 'harshHf', 'low')) {
    const gain = hasIssue(diagnosis.issues, 'harshHf', 'high') ? -3 : -1.8;
    filters.push({ type: 'peaking', frequency: 4500, Q: 1.4, gain });
    notes.push(`Tame harshness ~4.5 kHz (${gain} dB)`);
  }
  if (hasIssue(diagnosis.issues, 'lowDynamics', 'medium')) {
    // Slight air restore when already crushed
    filters.push({ type: 'highshelf', frequency: 10000, Q: 0.7, gain: 1.2 });
    notes.push('Add slight air shelf for crushed dynamics');
  }
  if (diagnosis.estimatedLufs < -20) {
    filters.push({ type: 'lowshelf', frequency: 120, Q: 0.7, gain: 1.0 });
    notes.push('Gentle low shelf for quiet program');
  }

  if (filters.length === 0) {
    onProgress?.(100, 'No corrective EQ needed');
    notes.push('Tonal balance OK — no corrective EQ.');
    return { buffer, notes };
  }

  onProgress?.(20, 'Applying corrective EQ...');
  await yieldToUI();

  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  let node: AudioNode = src;
  for (const f of filters) {
    const b = ctx.createBiquadFilter();
    b.type = f.type;
    b.frequency.value = f.frequency;
    b.Q.value = f.Q;
    b.gain.value = f.gain;
    node.connect(b);
    node = b;
  }
  node.connect(ctx.destination);
  src.start(0);
  onProgress?.(70, 'Rendering corrective EQ...');
  const out = await ctx.startRendering();
  onProgress?.(100, 'Corrective EQ done');
  return { buffer: out, notes };
}

export async function runAssemblyLine(
  buffer: AudioBuffer,
  options: AssemblyLineOptions = {}
): Promise<AssemblyLineResult> {
  const {
    onProgress,
    signal,
    targetLUFS = -14,
    streamingTarget = 'spotify',
    hitMaker = true,
    studioTune = true,
    resonanceCleanup = true,
    vocalPocket = true,
  } = options;
  const stageNotes: AssemblyStageNote[] = [];
  const delivery = getStreamingTarget(streamingTarget);

  // ── 1. Analyze ───────────────────────────────────────────────
  throwIfAborted(signal);
  onProgress?.(2, 'analyze', 'Analyzing structure and issues...');
  await yieldToUI();
  const { diagnosis, sections } = await analyzePipeline(buffer, mapProgress(onProgress, 'analyze', 2, 6));
  await yieldToUI();
  stageNotes.push({
    stage: 'analyze',
    label: ASSEMBLY_STAGE_LABELS.analyze,
    notes: [
      ...diagnosis.notes,
      ...diagnosis.issues.map((i) => `[${i.severity}] ${i.message}`),
      ...diagnosis.sectionFlags.flatMap((f) => f.issues.map((x) => `${f.name}: ${x}`)),
    ],
  });

  // ── 2. Repair on the stereo mix ──────────────────────────────
  throwIfAborted(signal);
  onProgress?.(9, 'repair', 'Cleanup bay...');
  await yieldToUI();
  const repairSettings = repairFromDiagnosis(diagnosis);
  const repaired = await runAudioRepair(
    buffer,
    repairSettings,
    mapProgress(onProgress, 'repair', 9, 8)
  );
  await yieldToUI();
  stageNotes.push({
    stage: 'repair',
    label: ASSEMBLY_STAGE_LABELS.repair,
    notes: repaired.notes.length ? repaired.notes : ['Light cleanup pass.'],
  });

  // ── 3. Surgical resonance EQ ─────────────────────────────────
  let afterResonance = repaired.buffer;
  if (resonanceCleanup) {
    throwIfAborted(signal);
    onProgress?.(18, 'resonance', 'Hunting resonances...');
    await yieldToUI();
    const res = await applyResonanceCleanup(
      repaired.buffer,
      mapProgress(onProgress, 'resonance', 18, 8)
    );
    afterResonance = res.buffer;
    await yieldToUI();
    stageNotes.push({
      stage: 'resonance',
      label: ASSEMBLY_STAGE_LABELS.resonance,
      notes: res.notes,
    });
  } else {
    stageNotes.push({
      stage: 'resonance',
      label: ASSEMBLY_STAGE_LABELS.resonance,
      notes: ['Resonance cleanup skipped.'],
    });
  }

  // ── 4. Corrective EQ from diagnosis ──────────────────────────
  throwIfAborted(signal);
  onProgress?.(27, 'fix', 'Fixing problem bands...');
  await yieldToUI();
  const corrected = await applyCorrectiveEq(
    afterResonance,
    diagnosis,
    mapProgress(onProgress, 'fix', 27, 6)
  );
  await yieldToUI();
  stageNotes.push({
    stage: 'fix',
    label: ASSEMBLY_STAGE_LABELS.fix,
    notes: corrected.notes,
  });

  // ── 5. Level ─────────────────────────────────────────────────
  throwIfAborted(signal);
  onProgress?.(34, 'level', 'Gain staging...');
  await yieldToUI();
  const levelMode =
    hasIssue(diagnosis.issues, 'loudness', 'medium') && diagnosis.estimatedLufs > -11
      ? 'mix'
      : diagnosis.estimatedLufs < -20
      ? 'loudness'
      : 'mix';
  const leveled = await autoLevelTrack(
    corrected.buffer,
    { mode: levelMode },
    mapProgress(onProgress, 'level', 34, 6)
  );
  await yieldToUI();
  stageNotes.push({
    stage: 'level',
    label: ASSEMBLY_STAGE_LABELS.level,
    notes: [
      `Mode: ${levelMode} · ${leveled.gainAppliedDb >= 0 ? '+' : ''}${leveled.gainAppliedDb.toFixed(1)} dB`,
      ...leveled.recommendations.slice(0, 4),
    ],
  });

  // ── 6. Vocal pocket (center ride + carve) ────────────────────
  let afterPocket = leveled.buffer;
  if (vocalPocket) {
    throwIfAborted(signal);
    onProgress?.(41, 'pocket', 'Vocal pocket — sitting the lead...');
    await yieldToUI();
    const pocket = await applyVocalPocket(
      leveled.buffer,
      mapProgress(onProgress, 'pocket', 41, 7)
    );
    afterPocket = pocket.buffer;
    await yieldToUI();
    stageNotes.push({
      stage: 'pocket',
      label: ASSEMBLY_STAGE_LABELS.pocket,
      notes: pocket.notes,
    });
  } else {
    stageNotes.push({
      stage: 'pocket',
      label: ASSEMBLY_STAGE_LABELS.pocket,
      notes: ['Vocal pocket skipped.'],
    });
  }

  // ── 7. Studio Tune (natural pitch polish) ────────────────────
  let afterTune = afterPocket;
  if (studioTune) {
    throwIfAborted(signal);
    onProgress?.(49, 'tune', 'Studio Tune — natural pitch polish...');
    await yieldToUI();
    const tuned = await applyAssemblyStudioTune(
      afterPocket,
      mapProgress(onProgress, 'tune', 49, 9)
    );
    afterTune = tuned.buffer;
    await yieldToUI();
    stageNotes.push({
      stage: 'tune',
      label: ASSEMBLY_STAGE_LABELS.tune,
      notes: tuned.notes,
    });
  } else {
    stageNotes.push({
      stage: 'tune',
      label: ASSEMBLY_STAGE_LABELS.tune,
      notes: ['Studio Tune skipped.'],
    });
  }

  // ── 8. Smart Enhance (adaptive polish) ───────────────────────
  let masterInput = afterTune;
  let enhanceCharacter: SonicCharacter | null = null;
  let enhanceIntensity = 0.5;

  if (hitMaker) {
    throwIfAborted(signal);
    onProgress?.(59, 'hit', 'Smart Enhance — adapting to the track...');
    await yieldToUI();
    const enhanced = await applySmartEnhance(afterTune, sections, diagnosis, {
      onProgress: mapProgress(onProgress, 'hit', 59, 9),
    });
    masterInput = enhanced.buffer;
    enhanceCharacter = enhanced.character;
    enhanceIntensity = enhanced.intensity;
    stageNotes.push({
      stage: 'hit',
      label: ASSEMBLY_STAGE_LABELS.hit,
      notes: enhanced.notes,
    });
  } else {
    stageNotes.push({
      stage: 'hit',
      label: ASSEMBLY_STAGE_LABELS.hit,
      notes: ['Smart Enhance skipped — transparent path only.'],
    });
  }

  // ── 9. Master (streaming-aware) ──────────────────────────────
  throwIfAborted(signal);
  onProgress?.(70, 'master', 'Analyzing for master...');
  await yieldToUI();
  const trackAnalysis = analyzeAndMasterTrack(masterInput, mapProgress(onProgress, 'master', 70, 4));
  await yieldToUI();

  onProgress?.(75, 'master', 'Sonic character...');
  await yieldToUI();
  const character = detectSonicCharacter(masterInput);
  const profile = getProcessingProfile(character.character, character.traits);

  // Platform target is the primary objective; character may bias slightly
  let masterTarget = delivery.lufs;
  if (typeof targetLUFS === 'number' && streamingTarget === undefined) {
    masterTarget = targetLUFS;
  }
  // Soft vibes: don't crush dynamics beyond platform
  if (hitMaker && enhanceCharacter) {
    const soft =
      enhanceCharacter === 'minimal' ||
      enhanceCharacter === 'moody' ||
      enhanceCharacter === 'atmospheric' ||
      enhanceCharacter === 'soulful';
    if (soft && delivery.id !== 'dynamic') {
      masterTarget = Math.min(masterTarget, delivery.lufs); // keep platform or quieter
      masterTarget = Math.max(masterTarget, delivery.lufs - 1.5);
    }
  }
  if (hasIssue(diagnosis.issues, 'loudness', 'medium') && diagnosis.estimatedLufs > -11) {
    // Already loud program — prefer not to push harder than platform
    masterTarget = Math.min(masterTarget, delivery.lufs);
  }
  if (diagnosis.estimatedLufs < -18 && delivery.id !== 'dynamic') {
    masterTarget = Math.max(masterTarget, Math.min(delivery.lufs, -12.5));
  }

  let approach = {
    ...profile.masteringApproach,
    targetLUFS: masterTarget,
    truePeakCeiling: delivery.truePeak,
  };
  if (hitMaker && enhanceCharacter) {
    approach = smartEnhanceMasteringBoost(approach, enhanceCharacter, enhanceIntensity);
    // Re-assert platform ceiling / loudness after boost so streaming wins
    approach.targetLUFS = masterTarget;
    approach.truePeakCeiling = Math.min(approach.truePeakCeiling, delivery.truePeak);
  }
  if (hasIssue(diagnosis.issues, 'lowDynamics', 'high')) {
    approach.multibandAggression *= 0.45;
    approach.busCompGlue *= 0.4;
  }
  if (hasIssue(diagnosis.issues, 'harshHf', 'medium')) {
    approach.airBoost = Math.min(approach.airBoost, 0.4);
    approach.harmonicExcitement *= 0.6;
  }
  if (hasIssue(diagnosis.issues, 'mud', 'medium')) {
    approach.lowEndBoost = Math.min(approach.lowEndBoost, 0.25);
    approach.analogWarmth *= 0.7;
  }

  throwIfAborted(signal);
  onProgress?.(80, 'master', `Mastering for ${delivery.name}...`);
  await yieldToUI();
  const masteringStats = await applyMasteringChain(
    masterInput,
    trackAnalysis.analysis,
    masterTarget,
    mapProgress(onProgress, 'master', 80, 16),
    approach
  );
  await yieldToUI();

  stageNotes.push({
    stage: 'master',
    label: ASSEMBLY_STAGE_LABELS.master,
    notes: [
      `Delivery: ${delivery.name} → ${masterTarget} LUFS · TP ≤ ${delivery.truePeak} dBTP`,
      `Character: ${character.character} (${Math.round(character.confidence * 100)}%)`,
      `Final ${masteringStats.finalLUFS.toFixed(1)} LUFS · TP ${masteringStats.truePeak.toFixed(1)} dBTP`,
      hitMaker
        ? `Smart Enhance mastering (${enhanceCharacter ?? 'adaptive'} · intensity ${Math.round(enhanceIntensity * 100)}%)`
        : 'Transparent mastering profile',
      ...trackAnalysis.recommendations.map((r) => r.description).slice(0, 4),
    ],
  });

  onProgress?.(98, 'deliver', 'Preparing download...');
  await yieldToUI();

  onProgress?.(100, 'done', 'Assembly line complete');
  stageNotes.push({
    stage: 'deliver',
    label: ASSEMBLY_STAGE_LABELS.deliver,
    notes: [
      `24-bit WAV + 320 kbps MP3 · target ${delivery.name}`,
      'Final master ready for download and playback.',
    ],
  });
  const pathBits = [
    'analyze',
    'repair',
    resonanceCleanup ? 'resonance' : null,
    'correct',
    'level',
    vocalPocket ? 'vocal pocket' : null,
    studioTune ? 'studio tune' : null,
    hitMaker ? 'enhance' : null,
    'master',
    'deliver',
  ].filter(Boolean);
  stageNotes.push({
    stage: 'done',
    label: ASSEMBLY_STAGE_LABELS.done,
    notes: [
      `Full auto: ${pathBits.join(' → ')}.`,
      'Original muted · Final unmuted — use Swap A/B to compare.',
    ],
  });

  return {
    originalBuffer: buffer,
    finalBuffer: masteringStats.buffer,
    report: {
      sections,
      diagnosis,
      stageNotes,
      trackAnalysisNotes: trackAnalysis.recommendations.map((r) => r.description),
      finalLUFS: masteringStats.finalLUFS,
      truePeak: masteringStats.truePeak,
      bpm: diagnosis.bpm,
      sectionCount: sections.length,
      streamingTarget: delivery.name,
      streamingLUFS: masterTarget,
    },
  };
}
