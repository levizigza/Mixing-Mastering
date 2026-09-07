/** Diagnosis-weighted stereo cleanup before mastering (no destructive stem remaster). */

import { SongSection } from '@/types/audio';
import { analyzePipeline, PipelineDiagnosis, PipelineIssue } from '@/lib/pipeline-analyze';
import { runAudioRepair, RepairSettings } from '@/lib/audio-repair';
import { autoLevelTrack } from '@/lib/audio-leveler';
import { analyzeAndMasterTrack } from '@/lib/auto-mix';
import { applyMasteringChain } from '@/lib/mastering-chain';
import { detectSonicCharacter, getProcessingProfile } from '@/lib/sonic-character';
import { applySmartEnhance, smartEnhanceMasteringBoost } from '@/lib/hit-maker';
import type { SonicCharacter } from '@/lib/sonic-character';

export type AssemblyStageId =
  | 'analyze'
  | 'repair'
  | 'fix'
  | 'level'
  | 'hit'
  | 'master'
  | 'deliver'
  | 'done';

export const ASSEMBLY_STAGE_LABELS: Record<AssemblyStageId, string> = {
  analyze: 'Analyze',
  repair: 'Repair',
  fix: 'Correct',
  level: 'Level',
  hit: 'Smart Enhance',
  master: 'Master',
  deliver: 'Deliver',
  done: 'Done',
};

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
  targetLUFS?: number;
  /** Analysis-driven adaptive polish (genre/vibe aware) */
  hitMaker?: boolean;
  hitMakerIntensity?: number;
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
  // Meaningful cleanup — gate always helps; spectral only on shorter clips (handled in runAudioRepair)
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
    hitMaker = true,
    hitMakerIntensity = 0.75,
  } = options;
  const stageNotes: AssemblyStageNote[] = [];

  // ── 1. Analyze ───────────────────────────────────────────────
  throwIfAborted(signal);
  onProgress?.(3, 'analyze', 'Analyzing structure and issues...');
  await yieldToUI();
  const { diagnosis, sections } = await analyzePipeline(buffer, mapProgress(onProgress, 'analyze', 3, 10));
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
  onProgress?.(14, 'repair', 'Cleanup bay...');
  await yieldToUI();
  const repairSettings = repairFromDiagnosis(diagnosis);
  const repaired = await runAudioRepair(
    buffer,
    repairSettings,
    mapProgress(onProgress, 'repair', 14, 14)
  );
  await yieldToUI();
  stageNotes.push({
    stage: 'repair',
    label: ASSEMBLY_STAGE_LABELS.repair,
    notes: repaired.notes.length ? repaired.notes : ['Light cleanup pass.'],
  });

  // ── 3. Corrective EQ from diagnosis ──────────────────────────
  throwIfAborted(signal);
  onProgress?.(30, 'fix', 'Fixing problem bands...');
  await yieldToUI();
  const corrected = await applyCorrectiveEq(
    repaired.buffer,
    diagnosis,
    mapProgress(onProgress, 'fix', 30, 10)
  );
  await yieldToUI();
  stageNotes.push({
    stage: 'fix',
    label: ASSEMBLY_STAGE_LABELS.fix,
    notes: corrected.notes,
  });

  // ── 4. Level ─────────────────────────────────────────────────
  throwIfAborted(signal);
  onProgress?.(42, 'level', 'Gain staging...');
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
    mapProgress(onProgress, 'level', 42, 10)
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

  // ── 5. Smart Enhance (adaptive polish) ───────────────────────
  let masterInput = leveled.buffer;
  let enhanceCharacter: SonicCharacter | null = null;
  let enhanceIntensity = 0.5;

  if (hitMaker) {
    throwIfAborted(signal);
    onProgress?.(54, 'hit', 'Smart Enhance — adapting to the track...');
    await yieldToUI();
    const enhanced = await applySmartEnhance(leveled.buffer, sections, diagnosis, {
      // Omit intensity so enhance derives it from analysis (ballad vs banger)
      onProgress: mapProgress(onProgress, 'hit', 54, 12),
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

  // ── 6. Master (stereo — no heuristic stem remaster) ──────────
  throwIfAborted(signal);
  onProgress?.(68, 'master', 'Analyzing for master...');
  await yieldToUI();
  const trackAnalysis = analyzeAndMasterTrack(masterInput, mapProgress(onProgress, 'master', 68, 5));
  await yieldToUI();

  onProgress?.(74, 'master', 'Sonic character...');
  await yieldToUI();
  const character = detectSonicCharacter(masterInput);
  const profile = getProcessingProfile(character.character, character.traits);

  let masterTarget = profile.masteringApproach.targetLUFS ?? targetLUFS;
  if (hitMaker && enhanceCharacter) {
    // Soft vibes stay near streaming norm; energetic vibes go more competitive
    const soft =
      enhanceCharacter === 'minimal' ||
      enhanceCharacter === 'moody' ||
      enhanceCharacter === 'atmospheric' ||
      enhanceCharacter === 'soulful';
    masterTarget = soft ? Math.min(masterTarget, -13) : Math.min(masterTarget, -11.5);
  }
  if (hasIssue(diagnosis.issues, 'loudness', 'medium') && diagnosis.estimatedLufs > -11) {
    masterTarget = Math.min(masterTarget, -13);
  }
  if (diagnosis.estimatedLufs < -18) {
    masterTarget = Math.max(masterTarget, hitMaker ? -12.5 : -14);
  }

  let approach = { ...profile.masteringApproach, targetLUFS: masterTarget };
  if (hitMaker && enhanceCharacter) {
    approach = smartEnhanceMasteringBoost(approach, enhanceCharacter, enhanceIntensity);
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
  onProgress?.(80, 'master', 'Mastering chain...');
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
      `Character: ${character.character} (${Math.round(character.confidence * 100)}%)`,
      `Target ${masterTarget} LUFS → final ${masteringStats.finalLUFS.toFixed(1)} · TP ${masteringStats.truePeak.toFixed(1)} dBTP`,
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
    notes: ['Final master ready for download and playback.'],
  });
  stageNotes.push({
    stage: 'done',
    label: ASSEMBLY_STAGE_LABELS.done,
    notes: [
      hitMaker
        ? 'Full auto + Smart Enhance: analyze → repair → correct → level → enhance → master → deliver.'
        : 'Full auto: analyze → repair → correct → level → master → deliver.',
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
    },
  };
}
