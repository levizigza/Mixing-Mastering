/** Structure + issue diagnosis for the Assembly Line pipeline. */

import { SongSection, SongSectionKind } from '@/types/audio';
import { SECTION_COLORS } from '@/lib/defaults';
import { analyzeBeat, BeatAnalysis } from '@/lib/beat-optimizer';
import { generateId } from '@/lib/utils';
import { RepairSettings, defaultRepairSettings } from '@/lib/audio-repair';

export type PipelineIssueId =
  | 'clipping'
  | 'noiseFloor'
  | 'mud'
  | 'harshHf'
  | 'loudness'
  | 'imbalance'
  | 'lowDynamics';

export interface PipelineIssue {
  id: PipelineIssueId;
  severity: 'low' | 'medium' | 'high';
  message: string;
}

export interface PipelineSectionFlag {
  sectionId: string;
  name: string;
  issues: string[];
}

export interface PipelineDiagnosis {
  bpm: number;
  duration: number;
  peakDb: number;
  rmsDb: number;
  estimatedLufs: number;
  crestFactor: number;
  stereoImbalanceDb: number;
  mudRatio: number;
  harshRatio: number;
  issues: PipelineIssue[];
  sectionFlags: PipelineSectionFlag[];
  beat: BeatAnalysis;
  repairSettings: RepairSettings;
  notes: string[];
}

function toDb(linear: number): number {
  return linear > 1e-10 ? 20 * Math.log10(linear) : -100;
}

function getPeakRms(buffer: AudioBuffer): { peak: number; rms: number } {
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  let peak = 0;
  let sum = 0;
  const n = buffer.length;
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(ch0[i]), Math.abs(ch1[i]));
    if (a > peak) peak = a;
    sum += a * a;
  }
  return { peak, rms: Math.sqrt(sum / n) };
}

function stereoImbalanceDb(buffer: AudioBuffer): number {
  if (buffer.numberOfChannels < 2) return 0;
  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);
  let sl = 0;
  let sr = 0;
  for (let i = 0; i < buffer.length; i++) {
    sl += L[i] * L[i];
    sr += R[i] * R[i];
  }
  const rl = Math.sqrt(sl / buffer.length);
  const rr = Math.sqrt(sr / buffer.length);
  return toDb(rl + 1e-12) - toDb(rr + 1e-12);
}

/** Crude band energy via simple IIR shelf approximation on mono mix. */
function bandEnergyRatio(buffer: AudioBuffer): { mud: number; harsh: number } {
  const sr = buffer.sampleRate;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  let low = 0;
  let mid = 0;
  let high = 0;
  let total = 0;
  // One-pole LP ~200 Hz and HP ~6 kHz approximations via EMA
  const aLow = Math.exp((-2 * Math.PI * 200) / sr);
  const aHigh = Math.exp((-2 * Math.PI * 6000) / sr);
  let lp = 0;
  let hpState = 0;
  for (let i = 0; i < buffer.length; i++) {
    const x = 0.5 * (L[i] + R[i]);
    lp = aLow * lp + (1 - aLow) * x;
    const hp = x - (aHigh * hpState + (1 - aHigh) * x);
    hpState = x;
    const e = x * x;
    const eLow = lp * lp;
    const eHigh = hp * hp;
    total += e;
    low += eLow;
    high += eHigh;
    mid += Math.max(0, e - eLow - eHigh);
  }
  if (total < 1e-12) return { mud: 0, harsh: 0 };
  return { mud: low / total, harsh: high / total };
}

function analyzeEnergyContour(buffer: AudioBuffer, windowSeconds = 2): Float32Array {
  const sr = buffer.sampleRate;
  const windowSize = Math.floor(sr * windowSeconds);
  const hopSize = Math.floor(windowSize / 2);
  const data = buffer.getChannelData(0);
  const numWindows = Math.max(1, Math.floor((data.length - windowSize) / hopSize) + 1);
  const energy = new Float32Array(numWindows);
  for (let w = 0; w < numWindows; w++) {
    const start = w * hopSize;
    let rms = 0;
    for (let i = start; i < start + windowSize && i < data.length; i++) {
      rms += data[i] * data[i];
    }
    energy[w] = Math.sqrt(rms / windowSize);
  }
  let maxE = 0;
  for (let i = 0; i < energy.length; i++) if (energy[i] > maxE) maxE = energy[i];
  if (maxE > 0) for (let i = 0; i < energy.length; i++) energy[i] /= maxE;
  return energy;
}

function mergeEnergyToSongSections(
  energy: Float32Array,
  duration: number,
  sampleRate: number,
  windowSeconds = 2
): SongSection[] {
  const hop = windowSeconds / 2;
  const num = energy.length;
  if (num === 0 || duration <= 0) {
    return [
      {
        id: generateId(),
        kind: 'custom',
        name: 'Full',
        start: 0,
        end: duration,
        color: SECTION_COLORS.custom,
      },
    ];
  }

  let avg = 0;
  for (let i = 0; i < num; i++) avg += energy[i];
  avg /= num;

  // Coalesce consecutive windows with same coarse label
  type Label = SongSectionKind;
  const labels: Label[] = [];
  for (let i = 0; i < num; i++) {
    const e = energy[i];
    const prev = i > 0 ? energy[i - 1] : e;
    const next = i < num - 1 ? energy[i + 1] : e;
    const isPeak = e >= prev && e >= next && e > avg * 1.15;
    const isQuiet = e < avg * 0.65;
    const isClimb = e > prev + 0.08;
    if (i < Math.max(1, num * 0.08)) labels.push('intro');
    else if (i > num * 0.88) labels.push('outro');
    else if (isPeak) labels.push('chorus');
    else if (isQuiet) labels.push('verse');
    else if (isClimb) labels.push('bridge');
    else labels.push('verse');
  }

  const sections: SongSection[] = [];
  let startIdx = 0;
  for (let i = 1; i <= num; i++) {
    if (i === num || labels[i] !== labels[startIdx]) {
      const kind = labels[startIdx];
      const start = Math.min(duration, startIdx * hop);
      const end = Math.min(duration, i === num ? duration : i * hop);
      if (end - start >= 1.5 || sections.length === 0) {
        const name =
          kind === 'intro'
            ? 'Intro'
            : kind === 'outro'
            ? 'Outro'
            : kind === 'chorus'
            ? 'Chorus'
            : kind === 'bridge'
            ? 'Bridge'
            : 'Verse';
        sections.push({
          id: generateId(),
          kind,
          name: `${name} ${sections.filter((s) => s.kind === kind).length + 1}`,
          start,
          end,
          color: SECTION_COLORS[kind] ?? SECTION_COLORS.custom,
        });
      } else if (sections.length > 0) {
        sections[sections.length - 1].end = end;
      }
      startIdx = i;
    }
  }

  if (sections.length === 0) {
    sections.push({
      id: generateId(),
      kind: 'custom',
      name: 'Full',
      start: 0,
      end: duration,
      color: SECTION_COLORS.custom,
    });
  } else {
    sections[0].start = 0;
    sections[sections.length - 1].end = duration;
  }

  void sampleRate;
  return sections;
}

function flagSections(
  sections: SongSection[],
  energy: Float32Array,
  windowSeconds: number,
  issues: PipelineIssue[]
): PipelineSectionFlag[] {
  const hop = windowSeconds / 2;
  const flags: PipelineSectionFlag[] = [];
  for (const s of sections) {
    const startW = Math.floor(s.start / hop);
    const endW = Math.min(energy.length - 1, Math.floor(s.end / hop));
    let sum = 0;
    let count = 0;
    for (let i = startW; i <= endW; i++) {
      sum += energy[i] ?? 0;
      count++;
    }
    const avgE = count > 0 ? sum / count : 0;
    const local: string[] = [];
    if (s.kind === 'chorus' && issues.some((i) => i.id === 'clipping')) {
      local.push('Peak energy — watch clipping/limiting');
    }
    if (s.kind === 'verse' && avgE < 0.4 && issues.some((i) => i.id === 'noiseFloor')) {
      local.push('Quiet section — denoise / gate focus');
    }
    if (s.kind === 'chorus' && issues.some((i) => i.id === 'harshHf')) {
      local.push('Bright peak — tame harsh HF');
    }
    if (s.kind === 'verse' && issues.some((i) => i.id === 'mud')) {
      local.push('Low-energy mud risk — carve 200–400 Hz');
    }
    if (local.length) {
      flags.push({ sectionId: s.id, name: s.name, issues: local });
    }
  }
  return flags;
}

function buildRepairSettings(issues: PipelineIssue[]): RepairSettings {
  const s = { ...defaultRepairSettings };
  const has = (id: PipelineIssueId) => issues.find((i) => i.id === id);
  const clip = has('clipping');
  if (clip) s.declip = clip.severity === 'high' ? 75 : clip.severity === 'medium' ? 55 : 40;
  const noise = has('noiseFloor');
  if (noise) s.denoise = noise.severity === 'high' ? 70 : noise.severity === 'medium' ? 55 : 40;
  else s.denoise = 30;
  const mud = has('mud');
  if (mud) {
    s.deplosive = 55;
    s.dereverb = Math.max(s.dereverb, 35);
  }
  if (has('loudness')?.severity === 'high') {
    s.declip = Math.max(s.declip, 50);
  }
  s.declick = Math.max(35, s.declick);
  s.dehum = 40;
  return s;
}

export interface PipelineAnalyzeResult {
  diagnosis: PipelineDiagnosis;
  sections: SongSection[];
}

export function analyzePipeline(
  buffer: AudioBuffer,
  onProgress?: (p: number, m: string) => void
): PipelineAnalyzeResult {
  onProgress?.(5, 'Measuring levels...');
  const { peak, rms } = getPeakRms(buffer);
  const peakDb = toDb(peak);
  const rmsDb = toDb(rms);
  const crestFactor = peakDb - rmsDb;
  // Rough LUFS proxy from RMS
  const estimatedLufs = rmsDb - 0.691;

  onProgress?.(20, 'Detecting beat...');
  // Beat detection on a short preview — full-song scan freezes the tab
  const previewSec = Math.min(buffer.duration, 45);
  const previewLen = Math.max(1, Math.floor(previewSec * buffer.sampleRate));
  const previewCtx = new OfflineAudioContext(buffer.numberOfChannels, previewLen, buffer.sampleRate);
  const preview = previewCtx.createBuffer(buffer.numberOfChannels, previewLen, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    preview.copyToChannel(buffer.getChannelData(ch).slice(0, previewLen), ch);
  }
  const beat = analyzeBeat(preview);

  onProgress?.(40, 'Mapping song structure...');
  const windowSeconds = 2;
  const energy = analyzeEnergyContour(buffer, windowSeconds);
  const sections = mergeEnergyToSongSections(energy, buffer.duration, buffer.sampleRate, windowSeconds);

  onProgress?.(60, 'Spectral balance...');
  const imbalance = stereoImbalanceDb(buffer);
  const { mud, harsh } = bandEnergyRatio(buffer);

  const issues: PipelineIssue[] = [];
  const notes: string[] = [];

  if (peakDb > -0.3) {
    issues.push({
      id: 'clipping',
      severity: peakDb > -0.05 ? 'high' : 'medium',
      message: `Peaks near 0 dBFS (${peakDb.toFixed(1)} dB) — soft de-clip + headroom`,
    });
  }
  if (rmsDb < -28) {
    issues.push({
      id: 'noiseFloor',
      severity: rmsDb < -35 ? 'high' : 'medium',
      message: `Low RMS (${rmsDb.toFixed(1)} dB) — quiet / noisy floor risk`,
    });
  }
  if (mud > 0.42) {
    issues.push({
      id: 'mud',
      severity: mud > 0.55 ? 'high' : 'medium',
      message: 'Excess low-mid energy — mud / boxiness',
    });
  }
  if (harsh > 0.28) {
    issues.push({
      id: 'harshHf',
      severity: harsh > 0.38 ? 'high' : 'medium',
      message: 'Elevated high-frequency energy — possible harshness',
    });
  }
  if (estimatedLufs > -10) {
    issues.push({
      id: 'loudness',
      severity: estimatedLufs > -8 ? 'high' : 'medium',
      message: `Already loud (~${estimatedLufs.toFixed(1)} LUFS) — gentle master`,
    });
  } else if (estimatedLufs < -22) {
    issues.push({
      id: 'loudness',
      severity: 'low',
      message: `Quiet program (~${estimatedLufs.toFixed(1)} LUFS) — room to gain-stage`,
    });
  }
  if (Math.abs(imbalance) > 2.5) {
    issues.push({
      id: 'imbalance',
      severity: Math.abs(imbalance) > 5 ? 'high' : 'medium',
      message: `L/R imbalance ${imbalance > 0 ? '+' : ''}${imbalance.toFixed(1)} dB`,
    });
  }
  if (crestFactor < 6) {
    issues.push({
      id: 'lowDynamics',
      severity: crestFactor < 4 ? 'high' : 'medium',
      message: `Low crest (${crestFactor.toFixed(1)} dB) — already compressed`,
    });
  }

  const sectionFlags = flagSections(sections, energy, windowSeconds, issues);
  const repairSettings = buildRepairSettings(issues);

  notes.push(`Detected ${sections.length} sections · ~${Math.round(beat.bpm)} BPM`);
  if (issues.length === 0) notes.push('Mix looks healthy — light cleanup then polish.');
  else notes.push(`${issues.length} issue flag(s) will drive repair / mix emphasis.`);

  onProgress?.(100, 'Diagnosis complete');

  return {
    sections,
    diagnosis: {
      bpm: beat.bpm,
      duration: buffer.duration,
      peakDb,
      rmsDb,
      estimatedLufs,
      crestFactor,
      stereoImbalanceDb: imbalance,
      mudRatio: mud,
      harshRatio: harsh,
      issues,
      sectionFlags,
      beat,
      repairSettings,
      notes,
    },
  };
}
