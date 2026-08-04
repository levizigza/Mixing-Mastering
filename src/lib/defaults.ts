import {
  StemProcessing,
  MasterProcessing,
  EQBand,
  CompressorSettings,
  SaturationSettings,
  LimiterSettings,
  StereoWidthSettings,
  StereoImagerSettings,
  TransportState,
  MeterData,
  BusState,
  BusId,
  DeliveryMetadata,
} from '@/types/audio';

export const defaultEQBands: EQBand[] = [
  { frequency: 200, gain: 0, Q: 1.0, type: 'lowshelf' },
  { frequency: 1000, gain: 0, Q: 1.0, type: 'peaking' },
  { frequency: 5000, gain: 0, Q: 1.0, type: 'highshelf' },
];

export const defaultCompressor: CompressorSettings = {
  threshold: -24,
  ratio: 4,
  attack: 0.003,
  release: 0.25,
  knee: 6,
  makeupGain: 0,
};

export const defaultSaturation: SaturationSettings = {
  drive: 0,
  mix: 0,
};

export const defaultLimiter: LimiterSettings = {
  threshold: -1,
  release: 0.05,
};

export const defaultStereoWidth: StereoWidthSettings = {
  width: 1.0,
};

export const defaultStereoImager: StereoImagerSettings = {
  lowWidth: 0.5,
  midWidth: 1.0,
  highWidth: 1.3,
  bassMonoFreq: 80,
  globalWidth: 1.0,
};

export const defaultStemProcessing: StemProcessing = {
  eq: [...defaultEQBands],
  compressor: { ...defaultCompressor },
  saturation: { ...defaultSaturation },
  gain: 0,
  pan: 0,
  mute: false,
  solo: false,
  bypass: false,
};

export const defaultMasterProcessing: MasterProcessing = {
  eq: [
    { frequency: 80, gain: 0, Q: 1.0, type: 'lowshelf' },
    { frequency: 1000, gain: 0, Q: 1.0, type: 'peaking' },
    { frequency: 8000, gain: 0, Q: 1.0, type: 'highshelf' },
  ],
  compressor: { ...defaultCompressor, threshold: -12, ratio: 2 },
  limiter: { ...defaultLimiter },
  saturation: { ...defaultSaturation },
  stereoWidth: { ...defaultStereoWidth },
  stereoImager: { ...defaultStereoImager },
  gain: 0,
  bypass: false,
};

export const defaultTransport: TransportState = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  loop: false,
  loopStart: 0,
  loopEnd: 0,
};

export const defaultMeterData: MeterData = {
  peakL: -Infinity,
  peakR: -Infinity,
  rmsL: -Infinity,
  rmsR: -Infinity,
  lufs: -Infinity,
  clipCount: 0,
};

const BUS_LABELS: Record<BusId, string> = {
  drums: 'Drums',
  bass: 'Bass',
  music: 'Music',
  vocals: 'Vocals',
  dialogue: 'Dialogue',
  sfx: 'SFX',
  fx: 'FX',
};

export const ALL_BUS_IDS: BusId[] = [
  'drums',
  'bass',
  'music',
  'vocals',
  'dialogue',
  'sfx',
  'fx',
];

export function createDefaultBuses(): BusState[] {
  return ALL_BUS_IDS.map((id) => ({
    id,
    label: BUS_LABELS[id],
    gain: 0,
    mute: false,
    solo: false,
  }));
}

export const defaultDeliveryMetadata: DeliveryMetadata = {
  title: '',
  artist: '',
  album: '',
  isrc: '',
  year: '',
  genre: '',
  albumGapSec: 2,
};

export const SECTION_COLORS: Record<string, string> = {
  intro: '#64748b',
  verse: '#38bdf8',
  chorus: '#f59e0b',
  bridge: '#a78bfa',
  outro: '#94a3b8',
  custom: '#34d399',
};
