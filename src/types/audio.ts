export type StemType = 'vocals' | 'drums' | 'bass' | 'instruments' | 'fx' | 'fullmix';

/** Post-production track role — maps to group buses. */
export type TrackRole = 'music' | 'dialogue' | 'sfx';

export type BusId = 'drums' | 'bass' | 'music' | 'vocals' | 'dialogue' | 'sfx' | 'fx';

export type SongSectionKind = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro' | 'custom';

export type SendFxId = 'reverb' | 'delay';

export interface EQBand {
  frequency: number;
  gain: number;
  Q: number;
  type: BiquadFilterType;
}

export interface CompressorSettings {
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  knee: number;
  makeupGain: number;
}

export interface LimiterSettings {
  threshold: number;
  release: number;
}

export interface SaturationSettings {
  drive: number;
  mix: number;
}

export interface StereoWidthSettings {
  width: number;
}

export interface StereoImagerSettings {
  lowWidth: number;
  midWidth: number;
  highWidth: number;
  bassMonoFreq: number;
  globalWidth: number;
}

export interface StemProcessing {
  eq: EQBand[];
  compressor: CompressorSettings;
  saturation: SaturationSettings;
  gain: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  bypass: boolean;
}

export interface MasterProcessing {
  eq: EQBand[];
  compressor: CompressorSettings;
  limiter: LimiterSettings;
  saturation: SaturationSettings;
  stereoWidth: StereoWidthSettings;
  stereoImager: StereoImagerSettings;
  gain: number;
  bypass: boolean;
}

export interface Stem {
  id: string;
  name: string;
  type: StemType;
  file: File | null;
  audioBuffer: AudioBuffer | null;
  processing: StemProcessing;
  waveformData: Float32Array | null;
  peakLevel: number;
  rmsLevel: number;
  trackRole?: TrackRole;
  busId?: BusId;
  sends?: Partial<Record<SendFxId, number>>;
}

export interface AudioClip {
  id: string;
  stemId: string;
  bufferId: string;
  startTime: number;
  offset: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
  gain: number;
}

export interface SongSection {
  id: string;
  kind: SongSectionKind;
  name: string;
  start: number;
  end: number;
  color: string;
}

export interface BusState {
  id: BusId;
  label: string;
  gain: number;
  mute: boolean;
  solo: boolean;
}

export interface Marker {
  id: string;
  time: number;
  label: string;
  color: string;
}

export interface Region {
  id: string;
  start: number;
  end: number;
  label: string;
  color: string;
}

export interface DeliveryMetadata {
  title: string;
  artist: string;
  album: string;
  isrc: string;
  year: string;
  genre: string;
  albumGapSec: number;
}

export type BounceMode = 'fullmix' | 'region' | 'stems' | 'instrumental' | 'acapella';

export interface MeterData {
  peakL: number;
  peakR: number;
  rmsL: number;
  rmsR: number;
  lufs: number;
  clipCount: number;
}

export interface SpectrumData {
  frequencies: Float32Array;
  magnitudes: Float32Array;
}

export interface AnalysisResult {
  stemId: string;
  stemName: string;
  stemType: StemType;
  peakLevel: number;
  rmsLevel: number;
  dynamicRange: number;
  processing: StemProcessing;
}

export interface Preset {
  id: string;
  name: string;
  category: 'genre' | 'mood' | 'instrument' | 'mastering';
  description: string;
  stems: Partial<Record<StemType, Partial<StemProcessing>>>;
  master: Partial<MasterProcessing>;
}

export interface TransportState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
}

export interface StudioState {
  stems: Stem[];
  master: MasterProcessing;
  transport: TransportState;
  abBypass: boolean;
  selectedStemId: string | null;
  activePresetId: string | null;
  masterMeter: MeterData;
  isExporting: boolean;
  exportProgress: number;
}

export interface ProjectSessionV2 {
  version: 2;
  savedAt: string;
  stems: {
    id: string;
    name: string;
    type: StemType;
    processing: StemProcessing;
    trackRole?: TrackRole;
    busId?: BusId;
    sends?: Partial<Record<SendFxId, number>>;
    hasAudio: boolean;
  }[];
  masterProcessing: MasterProcessing;
  activePresetId: string | null;
  clips: AudioClip[];
  sections: SongSection[];
  buses: BusState[];
  markers: Marker[];
  regions: Region[];
  metadata: DeliveryMetadata;
  videoOffsetMs: number;
  transport: Pick<TransportState, 'loop' | 'loopStart' | 'loopEnd'>;
}

export function defaultBusIdForStem(type: StemType, role?: TrackRole): BusId {
  if (role === 'dialogue') return 'dialogue';
  if (role === 'sfx') return 'sfx';
  switch (type) {
    case 'drums':
      return 'drums';
    case 'bass':
      return 'bass';
    case 'vocals':
      return 'vocals';
    case 'fx':
      return 'fx';
    case 'instruments':
    case 'fullmix':
    default:
      return 'music';
  }
}
