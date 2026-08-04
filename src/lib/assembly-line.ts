/** One-button Assembly Line: analyze → repair → level → split → mix → master. */

import { SongSection } from '@/types/audio';
import { analyzePipeline, PipelineDiagnosis } from '@/lib/pipeline-analyze';
import { runAudioRepair } from '@/lib/audio-repair';
import { autoLevelTrack } from '@/lib/audio-leveler';
import { separateStems } from '@/lib/stem-separator';
import { autoMixAndMaster, analyzeAndMasterTrack } from '@/lib/auto-mix';
import { applyMasteringChain } from '@/lib/mastering-chain';
import { detectSonicCharacter, getProcessingProfile } from '@/lib/sonic-character';
import { bounceOfflineMix, stemsFromSeparated } from '@/lib/offline-mix-bounce';

export type AssemblyStageId =
  | 'analyze'
  | 'repair'
  | 'level'
  | 'split'
  | 'mix'
  | 'master'
  | 'done';

export const ASSEMBLY_STAGE_LABELS: Record<AssemblyStageId, string> = {
  analyze: 'Analyze',
  repair: 'Repair',
  level: 'Level',
  split: 'Separate',
  mix: 'Mix',
  master: 'Master',
  done: 'Done',
};

export interface AssemblyStageNote {
  stage: AssemblyStageId;
  label: string;
  notes: string[];
}

/** Lightweight report for React state — no AudioBuffers (those freeze/OOM the tab). */
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

export async function runAssemblyLine(
  buffer: AudioBuffer,
  options: AssemblyLineOptions = {}
): Promise<AssemblyLineResult> {
  const { onProgress, signal, trackName = 'Track', targetLUFS = -14 } = options;
  const stageNotes: AssemblyStageNote[] = [];
  const longTrack = buffer.duration > 210; // ~3.5 min — skip heavy remaster split

  // ── 1. Analyze ───────────────────────────────────────────────
  throwIfAborted(signal);
  onProgress?.(2, 'analyze', 'Analyzing structure and issues...');
  await yieldToUI();
  const { diagnosis, sections } = analyzePipeline(buffer, mapProgress(onProgress, 'analyze', 2, 10));
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

  // ── 2. Repair (light settings — avoid UI-freezing spectral on long files) ─
  throwIfAborted(signal);
  onProgress?.(12, 'repair', 'Cleanup bay...');
  await yieldToUI();
  const repairSettings = {
    ...diagnosis.repairSettings,
    denoise: Math.min(diagnosis.repairSettings.denoise, 18),
    dereverb: Math.min(diagnosis.repairSettings.dereverb, 15),
  };
  const repaired = await runAudioRepair(
    buffer,
    repairSettings,
    mapProgress(onProgress, 'repair', 12, 14)
  );
  await yieldToUI();
  stageNotes.push({
    stage: 'repair',
    label: ASSEMBLY_STAGE_LABELS.repair,
    notes: repaired.notes.length ? repaired.notes : ['Light cleanup pass.'],
  });

  // ── 3. Level ─────────────────────────────────────────────────
  throwIfAborted(signal);
  onProgress?.(28, 'level', 'Gain staging...');
  await yieldToUI();
  const leveled = await autoLevelTrack(
    repaired.buffer,
    { mode: 'mix' },
    mapProgress(onProgress, 'level', 28, 10)
  );
  await yieldToUI();
  stageNotes.push({
    stage: 'level',
    label: ASSEMBLY_STAGE_LABELS.level,
    notes: leveled.recommendations.length
      ? leveled.recommendations
      : [`Leveled for mix headroom (${leveled.gainAppliedDb.toFixed(1)} dB)`],
  });

  let masterInput = leveled.buffer;

  // ── 4–5. Separate + mix (skip on very long tracks to avoid tab crash) ─
  if (!longTrack) {
    throwIfAborted(signal);
    onProgress?.(40, 'split', 'Heuristic stem split...');
    await yieldToUI();
    const separated = await separateStems(
      leveled.buffer,
      mapProgress(onProgress, 'split', 40, 12)
    );
    throwIfAborted(signal);
    await yieldToUI();
    stageNotes.push({
      stage: 'split',
      label: ASSEMBLY_STAGE_LABELS.split,
      notes: ['Split into vocals / drums / bass / instruments (heuristic DSP).'],
    });

    throwIfAborted(signal);
    onProgress?.(54, 'mix', 'Auto-mix balance...');
    await yieldToUI();
    const heuristicStems = stemsFromSeparated(separated, trackName);
    const mixResult = autoMixAndMaster(heuristicStems, mapProgress(onProgress, 'mix', 54, 8));
    for (const stem of heuristicStems) {
      const settings = mixResult.stemSettings[stem.id];
      if (settings) stem.processing = settings;
    }

    throwIfAborted(signal);
    onProgress?.(64, 'mix', 'Bouncing mixed stereo...');
    await yieldToUI();
    try {
      masterInput = await bounceOfflineMix(
        heuristicStems,
        mixResult.stemSettings,
        mapProgress(onProgress, 'mix', 64, 12)
      );
      stageNotes.push({
        stage: 'mix',
        label: ASSEMBLY_STAGE_LABELS.mix,
        notes: mixResult.analysis.map(
          (a) =>
            `${a.name}: peak ${a.peakDb.toFixed(1)} dB · RMS ${a.rmsDb.toFixed(1)} dB · crest ${a.crestFactor.toFixed(1)}`
        ),
      });
    } catch (mixErr) {
      console.warn('Mix bounce failed, mastering leveled stereo instead', mixErr);
      masterInput = leveled.buffer;
      stageNotes.push({
        stage: 'mix',
        label: ASSEMBLY_STAGE_LABELS.mix,
        notes: ['Mix bounce failed — continuing with leveled stereo.'],
      });
    }
  } else {
    onProgress?.(50, 'split', 'Long track — skipping stem remaster');
    await yieldToUI();
    stageNotes.push({
      stage: 'split',
      label: ASSEMBLY_STAGE_LABELS.split,
      notes: ['Skipped heuristic split (track > 3.5 min) to keep the browser responsive.'],
    });
    stageNotes.push({
      stage: 'mix',
      label: ASSEMBLY_STAGE_LABELS.mix,
      notes: ['Using leveled stereo into mastering.'],
    });
  }

  // ── 6. Master ────────────────────────────────────────────────
  throwIfAborted(signal);
  onProgress?.(78, 'master', 'Analyzing for master...');
  await yieldToUI();
  const trackAnalysis = analyzeAndMasterTrack(masterInput, mapProgress(onProgress, 'master', 78, 4));
  await yieldToUI();

  onProgress?.(84, 'master', 'Sonic character...');
  await yieldToUI();
  const character = detectSonicCharacter(masterInput);
  const profile = getProcessingProfile(character.character, character.traits);

  let masterTarget = profile.masteringApproach.targetLUFS ?? targetLUFS;
  if (diagnosis.issues.some((i) => i.id === 'loudness' && i.severity !== 'low')) {
    masterTarget = Math.min(masterTarget, -12);
  }

  throwIfAborted(signal);
  onProgress?.(88, 'master', 'Mastering chain...');
  await yieldToUI();
  const masteringStats = await applyMasteringChain(
    masterInput,
    trackAnalysis.analysis,
    masterTarget,
    mapProgress(onProgress, 'master', 88, 10),
    { ...profile.masteringApproach, targetLUFS: masterTarget }
  );
  await yieldToUI();

  stageNotes.push({
    stage: 'master',
    label: ASSEMBLY_STAGE_LABELS.master,
    notes: [
      `Character: ${character.character} (${Math.round(character.confidence * 100)}%)`,
      `Final LUFS: ${masteringStats.finalLUFS.toFixed(1)} · True peak: ${masteringStats.truePeak.toFixed(1)} dBTP`,
      ...trackAnalysis.recommendations.map((r) => r.description),
    ],
  });

  onProgress?.(100, 'done', 'Assembly line complete');
  stageNotes.push({
    stage: 'done',
    label: ASSEMBLY_STAGE_LABELS.done,
    notes: ['Original + Final ready for A/B. Sections mapped on timeline.'],
  });

  const report: AssemblyLineReportData = {
    sections,
    diagnosis,
    stageNotes,
    trackAnalysisNotes: trackAnalysis.recommendations.map((r) => r.description),
    finalLUFS: masteringStats.finalLUFS,
    truePeak: masteringStats.truePeak,
    bpm: diagnosis.bpm,
    sectionCount: sections.length,
  };

  return {
    originalBuffer: buffer,
    finalBuffer: masteringStats.buffer,
    report,
  };
}
