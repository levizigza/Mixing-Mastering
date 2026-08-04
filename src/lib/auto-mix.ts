import {
  Stem,
  StemType,
  StemProcessing,
  MasterProcessing,
  EQBand,
  CompressorSettings,
  SaturationSettings,
} from '@/types/audio';
import { defaultStemProcessing, defaultMasterProcessing } from './defaults';

// ─── Audio Analysis Helpers ────────────────────────────────────────

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
  return Math.sqrt(sum / count);
}

function getPeak(buffer: AudioBuffer): number {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }
  return peak;
}

function toDb(linear: number): number {
  return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
}

// 5-band spectral analysis with spectral centroid for intelligent EQ decisions
interface SpectralProfile {
  sub: number;      // < 100 Hz
  lowMid: number;   // 100-500 Hz
  mid: number;      // 500-2000 Hz
  presence: number; // 2000-6000 Hz
  air: number;      // > 6000 Hz
  centroid: number; // Weighted center frequency (Hz) — indicates brightness
}

function getSpectralProfile(buffer: AudioBuffer): SpectralProfile {
  const sampleRate = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const len = Math.min(data.length, sampleRate * 10);

  function biquadCoeffs(type: 'lp' | 'hp', freq: number) {
    const w0 = 2 * Math.PI * freq / sampleRate;
    const alpha = Math.sin(w0) / (2 * 0.7071);
    const cosW = Math.cos(w0);
    if (type === 'lp') {
      const b0 = (1 - cosW) / 2, b1 = 1 - cosW, b2 = (1 - cosW) / 2;
      const a0 = 1 + alpha, a1 = -2 * cosW, a2 = 1 - alpha;
      return { b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 };
    }
    const b0 = (1 + cosW) / 2, b1 = -(1 + cosW), b2 = (1 + cosW) / 2;
    const a0 = 1 + alpha, a1 = -2 * cosW, a2 = 1 - alpha;
    return { b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0 };
  }

  function filterEnergy(c: ReturnType<typeof biquadCoeffs>) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, energy = 0;
    for (let i = 0; i < len; i++) {
      const x = data[i];
      const y = c.b0*x + c.b1*x1 + c.b2*x2 - c.a1*y1 - c.a2*y2;
      energy += y * y;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
    }
    return energy / len;
  }

  const subE = filterEnergy(biquadCoeffs('lp', 100));
  const belowLowMid = filterEnergy(biquadCoeffs('lp', 500));
  const belowMid = filterEnergy(biquadCoeffs('lp', 2000));
  const belowPres = filterEnergy(biquadCoeffs('lp', 6000));
  const fullE = filterEnergy(biquadCoeffs('lp', 20000));
  const airE = Math.max(0, fullE - belowPres);
  const presE = Math.max(0, belowPres - belowMid);
  const midE = Math.max(0, belowMid - belowLowMid);
  const lowMidE = Math.max(0, belowLowMid - subE);

  const total = subE + lowMidE + midE + presE + airE || 1;

  // Spectral centroid: weighted average of band center frequencies
  const bandCenters = [50, 300, 1000, 4000, 10000];
  const bandEnergies = [subE, lowMidE, midE, presE, airE];
  let centroidNum = 0, centroidDen = 0;
  for (let b = 0; b < 5; b++) {
    centroidNum += bandCenters[b] * bandEnergies[b];
    centroidDen += bandEnergies[b];
  }
  const centroid = centroidDen > 0 ? centroidNum / centroidDen : 1000;

  return {
    sub: subE / total,
    lowMid: lowMidE / total,
    mid: midE / total,
    presence: presE / total,
    air: airE / total,
    centroid,
  };
}

function getFrequencyBalance(buffer: AudioBuffer): { low: number; mid: number; high: number } {
  const profile = getSpectralProfile(buffer);
  return {
    low: profile.sub + profile.lowMid,
    mid: profile.mid,
    high: profile.presence + profile.air,
  };
}

function getCrestFactor(buffer: AudioBuffer): number {
  const peak = getPeak(buffer);
  const rms = getRMS(buffer);
  if (rms <= 0) return 20;
  return toDb(peak) - toDb(rms);
}

function getStereoCorrelation(buffer: AudioBuffer): number {
  if (buffer.numberOfChannels < 2) return 1;
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const len = Math.min(left.length, 44100 * 10); // Sample 10 seconds
  
  let sumLR = 0, sumLL = 0, sumRR = 0;
  for (let i = 0; i < len; i++) {
    sumLR += left[i] * right[i];
    sumLL += left[i] * left[i];
    sumRR += right[i] * right[i];
  }
  
  const denom = Math.sqrt(sumLL * sumRR);
  return denom > 0 ? sumLR / denom : 1;
}

// ─── Industry-Standard Per-Stem Mixing Profiles ──────────────────
// Each profile mirrors how a professional mix engineer would approach
// the stem: surgical problem-frequency cuts, presence/air boosts,
// proper compression with attack/release tuned to the material,
// and harmonic coloring where appropriate.

interface StemProfile {
  eqCurve: EQBand[];
  compressor: CompressorSettings;
  saturation: SaturationSettings;
  pan: number;
  highpassFreq: number; // Everything below this gets cut (0 = no HPF)
  targetRmsDb: number;  // Industry gain staging target (RMS)
}

// Profiles follow LANDR / iZotope mixing order: subtractive cleanup first,
// then gentle presence. Targets use ~−18 dBFS RMS gain staging with a
// clear hierarchy so the static mix does most of the work.
const STEM_PROFILES: Record<StemType, StemProfile> = {
  vocals: {
    eqCurve: [
      { frequency: 90, gain: -18, Q: 0.7, type: 'highpass' as BiquadFilterType },
      { frequency: 220, gain: -2.0, Q: 1.8, type: 'peaking' as BiquadFilterType }, // Mud / boom
      { frequency: 3500, gain: 2.0, Q: 1.3, type: 'peaking' as BiquadFilterType }, // Presence
      { frequency: 11000, gain: 1.5, Q: 0.7, type: 'highshelf' as BiquadFilterType }, // Air
    ],
    compressor: { threshold: -18, ratio: 3.0, attack: 0.008, release: 0.1, knee: 8, makeupGain: 2 },
    saturation: { drive: 4, mix: 0.15 },
    pan: 0,
    highpassFreq: 90,
    targetRmsDb: -14, // Vocal sits on top
  },
  drums: {
    eqCurve: [
      { frequency: 35, gain: -12, Q: 0.7, type: 'highpass' as BiquadFilterType },
      { frequency: 55, gain: 2.0, Q: 1.4, type: 'peaking' as BiquadFilterType }, // Kick weight
      { frequency: 280, gain: -2.0, Q: 1.6, type: 'peaking' as BiquadFilterType }, // Boxiness
      { frequency: 4500, gain: 1.5, Q: 1.2, type: 'peaking' as BiquadFilterType }, // Snare/hat attack
      { frequency: 10000, gain: 1.0, Q: 0.7, type: 'highshelf' as BiquadFilterType },
    ],
    compressor: { threshold: -16, ratio: 3.5, attack: 0.001, release: 0.07, knee: 6, makeupGain: 2 },
    saturation: { drive: 6, mix: 0.12 },
    pan: 0,
    highpassFreq: 35,
    targetRmsDb: -16,
  },
  bass: {
    eqCurve: [
      { frequency: 35, gain: -6, Q: 0.7, type: 'highpass' as BiquadFilterType },
      { frequency: 70, gain: 1.5, Q: 1.2, type: 'peaking' as BiquadFilterType }, // Fundamental
      { frequency: 220, gain: -2.5, Q: 1.5, type: 'peaking' as BiquadFilterType }, // Low-mid mud
      { frequency: 900, gain: 1.5, Q: 1.3, type: 'peaking' as BiquadFilterType }, // Definition
      { frequency: 4000, gain: -8, Q: 0.7, type: 'lowpass' as BiquadFilterType },
    ],
    compressor: { threshold: -18, ratio: 4, attack: 0.012, release: 0.12, knee: 8, makeupGain: 2 },
    saturation: { drive: 8, mix: 0.2 }, // Harmonics for small-speaker audibility
    pan: 0,
    highpassFreq: 35,
    targetRmsDb: -17,
  },
  instruments: {
    eqCurve: [
      { frequency: 140, gain: -12, Q: 0.7, type: 'highpass' as BiquadFilterType },
      { frequency: 300, gain: -1.5, Q: 1.5, type: 'peaking' as BiquadFilterType },
      { frequency: 3000, gain: -2.0, Q: 2.5, type: 'peaking' as BiquadFilterType }, // Vocal pocket
      { frequency: 7000, gain: 1.0, Q: 0.8, type: 'highshelf' as BiquadFilterType },
    ],
    compressor: { threshold: -18, ratio: 2.5, attack: 0.012, release: 0.15, knee: 12, makeupGain: 1.5 },
    saturation: { drive: 3, mix: 0.1 },
    pan: 0,
    highpassFreq: 140,
    targetRmsDb: -18,
  },
  fx: {
    eqCurve: [
      { frequency: 250, gain: -12, Q: 0.5, type: 'highpass' as BiquadFilterType },
      { frequency: 500, gain: -1.5, Q: 1.5, type: 'peaking' as BiquadFilterType },
      { frequency: 2500, gain: 1.0, Q: 0.8, type: 'peaking' as BiquadFilterType },
      { frequency: 9000, gain: 1.5, Q: 0.6, type: 'highshelf' as BiquadFilterType },
    ],
    compressor: { threshold: -22, ratio: 2, attack: 0.02, release: 0.25, knee: 20, makeupGain: 1 },
    saturation: { drive: 0, mix: 0 },
    pan: 0,
    highpassFreq: 250,
    targetRmsDb: -22,
  },
  fullmix: {
    eqCurve: [
      { frequency: 30, gain: -6, Q: 0.7, type: 'highpass' as BiquadFilterType },
      { frequency: 250, gain: -1.0, Q: 1.4, type: 'peaking' as BiquadFilterType },
      { frequency: 3200, gain: 0.8, Q: 1.0, type: 'peaking' as BiquadFilterType },
      { frequency: 10000, gain: 1.0, Q: 0.6, type: 'highshelf' as BiquadFilterType },
    ],
    compressor: { threshold: -14, ratio: 2, attack: 0.015, release: 0.15, knee: 20, makeupGain: 1 },
    saturation: { drive: 0, mix: 0 },
    pan: 0,
    highpassFreq: 28,
    targetRmsDb: -16,
  },
};

// ─── Industry Pan Spread (LCR + Depth) ───────────────────────────
// Follows the LCR panning philosophy: elements are either hard left,
// center, or hard right — with some elements at partial positions.
// Drums/bass/vocals always center. Instruments spread. FX wide.

function calculatePanSpread(stems: Stem[]): Record<string, number> {
  const pans: Record<string, number> = {};
  const typeGroups: Record<string, string[]> = {};

  stems.forEach((s) => {
    if (!typeGroups[s.type]) typeGroups[s.type] = [];
    typeGroups[s.type].push(s.id);
  });

  stems.forEach((s) => {
    if (s.type === 'vocals' || s.type === 'bass' || s.type === 'fullmix') {
      pans[s.id] = 0; // Always dead center
    } else if (s.type === 'drums') {
      pans[s.id] = 0; // Drums centered (overhead panning handled by stereo content)
    } else if (s.type === 'instruments') {
      const group = typeGroups[s.type];
      const idx = group.indexOf(s.id);
      const count = group.length;
      if (count === 1) {
        pans[s.id] = -0.35; // Single instrument slightly left
      } else if (count === 2) {
        pans[s.id] = idx === 0 ? -0.7 : 0.7; // Hard LCR style
      } else {
        // Spread across stereo field
        pans[s.id] = -0.8 + (idx / (count - 1)) * 1.6;
      }
    } else if (s.type === 'fx') {
      const group = typeGroups[s.type];
      const idx = group.indexOf(s.id);
      const count = group.length;
      if (count === 1) {
        pans[s.id] = 0.45; // FX slightly right for interest
      } else {
        pans[s.id] = -0.9 + (idx / (count - 1)) * 1.8; // Wide spread
      }
    }
  });

  return pans;
}

// ─── Professional Gain Staging ───────────────────────────────────
// Industry standard: each stem targets an RMS level that provides
// proper headroom. Vocals slightly louder, instruments slightly lower.
// This gives the mix bus proper headroom for summing.

function calculateGainStaging(stems: Stem[]): Record<string, number> {
  const gains: Record<string, number> = {};

  // Static mix first (LANDR / SonicScoop): balance with faders only.
  // Relative hierarchy offsets keep the arrangement clear before EQ/comp.
  const hierarchyBoost: Record<StemType, number> = {
    vocals: 2.5,
    drums: 1.0,
    bass: 0.5,
    instruments: 0,
    fx: -3,
    fullmix: 0,
  };

  stems.forEach((s) => {
    if (!s.audioBuffer) {
      gains[s.id] = 0;
      return;
    }
    const profile = STEM_PROFILES[s.type];
    const targetRms = profile.targetRmsDb + (hierarchyBoost[s.type] ?? 0);
    const currentRms = toDb(getRMS(s.audioBuffer));
    const currentPeak = toDb(getPeak(s.audioBuffer));

    let adjustment = targetRms - currentRms;

    // Keep ≥3 dB peak headroom per stem for summing
    const projectedPeak = currentPeak + adjustment;
    if (projectedPeak > -3) {
      adjustment -= projectedPeak - (-3);
    }

    gains[s.id] = Math.max(-24, Math.min(18, adjustment));
  });

  // Vocal-forward: lead vocal must clear the loudest beat element
  const beatStems = stems.filter((s) => s.type === 'drums' || s.type === 'bass' || s.type === 'instruments');
  const vocalStems = stems.filter((s) => s.type === 'vocals');

  if (beatStems.length > 0 && vocalStems.length > 0) {
    let loudestBeat = -Infinity;
    for (const bs of beatStems) {
      if ((gains[bs.id] ?? -Infinity) > loudestBeat) loudestBeat = gains[bs.id];
    }
    const vocalFloor = loudestBeat + 2.0;
    for (const vs of vocalStems) {
      if ((gains[vs.id] ?? 0) < vocalFloor) gains[vs.id] = vocalFloor;
    }
  }

  // Summing headroom: if many stems, pull everything down so the bus isn't slamming
  if (stems.length >= 4) {
    const pullback = Math.min(6, (stems.length - 3) * 0.8);
    for (const id of Object.keys(gains)) gains[id] -= pullback;
  }

  return gains;
}

// ─── Frequency Carving / Anti-Masking ────────────────────────────
// Analyzes which stems compete for the same frequency space and
// applies surgical cuts to create separation between elements.

function calculateFrequencyCarving(
  stems: Stem[],
  baseEQs: Record<string, EQBand[]>
): Record<string, EQBand[]> {
  const carved = { ...baseEQs };
  const hasVocals = stems.some((s) => s.type === 'vocals');
  const hasBass = stems.some((s) => s.type === 'bass');
  const hasDrums = stems.some((s) => s.type === 'drums');

  // Spectral profiles for adaptive carving depth
  const profiles: Record<string, SpectralProfile> = {};
  for (const s of stems) {
    if (s.audioBuffer) profiles[s.id] = getSpectralProfile(s.audioBuffer);
  }

  stems.forEach((s) => {
    const eq = [...(carved[s.id] || [])];
    const sp = profiles[s.id];

    // Vocal pocket — deeper cut when instruments are presence-heavy
    if (hasVocals && (s.type === 'instruments' || s.type === 'fx')) {
      const depth = sp && sp.presence > 0.25 ? -3.0 : -2.0;
      eq.push({ frequency: 3200, gain: depth, Q: 2.8, type: 'peaking' as BiquadFilterType });
      eq.push({ frequency: 5000, gain: -1.0, Q: 2.0, type: 'peaking' as BiquadFilterType });
    }

    // Bass vs instruments low-mid
    if (hasBass && s.type === 'instruments') {
      eq.push({ frequency: 180, gain: -2.5, Q: 1.4, type: 'peaking' as BiquadFilterType });
    }

    // Kick / bass relationship: carve bass around kick fundamental
    if (s.type === 'bass' && hasDrums) {
      eq.push({ frequency: 55, gain: -2.0, Q: 2.2, type: 'peaking' as BiquadFilterType });
    }

    // Drums leave room for bass body
    if (s.type === 'drums' && hasBass) {
      eq.push({ frequency: 180, gain: -1.5, Q: 1.8, type: 'peaking' as BiquadFilterType });
    }

    // Extra HPF on non-bass/drums if sub-heavy
    if (sp && sp.sub > 0.2 && s.type !== 'bass' && s.type !== 'drums' && s.type !== 'fullmix') {
      eq.push({ frequency: Math.max(STEM_PROFILES[s.type].highpassFreq, 120), gain: -12, Q: 0.7, type: 'highpass' as BiquadFilterType });
    }

    carved[s.id] = eq;
  });

  return carved;
}

// ─── Adaptive EQ Based on Analysis ──────────────────────────────
// More nuanced than before: considers the actual frequency content
// and applies corrective moves with surgical precision.

function adaptEQ(baseEQ: EQBand[], freqBalance: { low: number; mid: number; high: number }, stemType: StemType): EQBand[] {
  return baseEQ.map((band) => {
    let gainAdjust = 0;

    if (band.frequency < 150) {
      if (stemType === 'bass' || stemType === 'drums') {
        gainAdjust = freqBalance.low > 0.6 ? -1.0 : 0;
      } else {
        gainAdjust = freqBalance.low > 0.45 ? -1.0 : 0;
      }
    } else if (band.frequency < 500) {
      // Only tame low-mids if genuinely muddy — preserve body
      gainAdjust = freqBalance.low > 0.5 ? -1.0 : 0;
    } else if (band.frequency < 2000) {
      if (stemType !== 'vocals') {
        gainAdjust = freqBalance.mid > 0.55 ? -0.5 : 0;
      }
    } else if (band.frequency < 6000) {
      // Presence: boost dark material, leave balanced material alone
      gainAdjust = freqBalance.high < 0.12 ? 1.0 : freqBalance.high > 0.55 ? -0.5 : 0;
    } else {
      // Air: add sparkle only if lacking, don't overdo it
      gainAdjust = freqBalance.high < 0.1 ? 1.0 : freqBalance.high > 0.5 ? -0.5 : 0;
    }

    return { ...band, gain: band.gain + gainAdjust };
  });
}

// ─── Serial Compression ─────────────────────────────────────────
// Industry technique: two compressors in series — first a fast one
// for peak control, then a slow one for leveling. This sounds more
// transparent than a single heavy compressor.

function calculateSerialCompression(base: CompressorSettings, crestFactor: number, stemType: StemType): CompressorSettings {
  const comp = { ...base };

  // Adapt based on dynamics
  if (crestFactor > 18) {
    // Very dynamic — needs solid compression
    comp.threshold = Math.max(comp.threshold - 3, -30);
    comp.ratio = Math.min(comp.ratio + 0.5, 6);
    comp.makeupGain = Math.min(comp.makeupGain + 2, 8);
  } else if (crestFactor > 14) {
    // Moderately dynamic — gentle touch
    comp.threshold = Math.max(comp.threshold - 1, -28);
    comp.makeupGain = Math.min(comp.makeupGain + 1, 6);
  } else if (crestFactor < 6) {
    // Already crushed — back off significantly
    comp.threshold = Math.min(comp.threshold + 8, -4);
    comp.ratio = Math.max(comp.ratio - 1.5, 1.2);
    comp.makeupGain = Math.max(comp.makeupGain - 2, 0);
  } else if (crestFactor < 10) {
    // Compressed — back off somewhat
    comp.threshold = Math.min(comp.threshold + 4, -8);
    comp.ratio = Math.max(comp.ratio - 0.5, 1.5);
    comp.makeupGain = Math.max(comp.makeupGain - 1, 0);
  }

  // Stem-specific attack/release tuning
  if (stemType === 'drums') {
    comp.attack = Math.min(comp.attack, 0.001); // Let transients through
    comp.release = Math.max(0.04, Math.min(comp.release, 0.08)); // Quick recovery
  } else if (stemType === 'vocals') {
    comp.attack = 0.008; // 8ms — let consonants and breaths through naturally
    comp.release = 0.1;  // 100ms — smooth, musical release
    comp.ratio = Math.min(comp.ratio, 3.5); // Cap at 3.5:1 — preserve natural vocal dynamics
  } else if (stemType === 'bass') {
    comp.attack = 0.01;  // Preserve note shape
    comp.release = 0.12; // Smooth
  }

  return comp;
}

// ─── Main Auto Mix Function ────────────────────────────────────────

export interface AutoMixResult {
  stemSettings: Record<string, StemProcessing>;
  masterSettings: MasterProcessing;
  analysis: {
    stemId: string;
    name: string;
    type: StemType;
    peakDb: number;
    rmsDb: number;
    crestFactor: number;
    freqBalance: { low: number; mid: number; high: number };
  }[];
}

export function autoMixAndMaster(
  stems: Stem[],
  onProgress?: (progress: number, message: string) => void
): AutoMixResult {
  const stemSettings: Record<string, StemProcessing> = {};
  const analysis: AutoMixResult['analysis'] = [];

  onProgress?.(5, 'Static mix — gain staging...');
  const panMap = calculatePanSpread(stems);
  const gainMap = calculateGainStaging(stems);

  onProgress?.(12, 'Analyzing stems...');

  // ─── Per-Stem Analysis ─────────────────────────────────────────
  const baseEQs: Record<string, EQBand[]> = {};

  stems.forEach((stem, idx) => {
    const progress = 10 + (idx / stems.length) * 30;
    onProgress?.(progress, `Analyzing ${stem.name}...`);

    const profile = STEM_PROFILES[stem.type];

    if (!stem.audioBuffer) {
      stemSettings[stem.id] = { ...defaultStemProcessing, pan: panMap[stem.id] ?? 0 };
      baseEQs[stem.id] = defaultStemProcessing.eq;
      return;
    }

    const peakDb = toDb(getPeak(stem.audioBuffer));
    const rmsDb = toDb(getRMS(stem.audioBuffer));
    const crestFactor = getCrestFactor(stem.audioBuffer);
    const freqBalance = getFrequencyBalance(stem.audioBuffer);

    analysis.push({
      stemId: stem.id,
      name: stem.name,
      type: stem.type,
      peakDb,
      rmsDb,
      crestFactor,
      freqBalance,
    });

    // Build adaptive EQ from profile + analysis
    const eq = adaptEQ(profile.eqCurve, freqBalance, stem.type);
    baseEQs[stem.id] = eq;

    // Serial compression adapted to dynamics + stem type
    const compressor = calculateSerialCompression(profile.compressor, crestFactor, stem.type);

    stemSettings[stem.id] = {
      eq,
      compressor,
      saturation: { ...profile.saturation },
      gain: gainMap[stem.id] ?? 0,
      pan: panMap[stem.id] ?? 0,
      mute: false,
      solo: false,
      bypass: false,
    };
  });

  // ─── Frequency Carving Pass ────────────────────────────────────
  // Second pass: apply anti-masking cuts based on what other stems are doing
  onProgress?.(42, 'Applying frequency carving (anti-masking)...');

  const carvedEQs = calculateFrequencyCarving(stems, baseEQs);
  for (const stem of stems) {
    if (stemSettings[stem.id] && carvedEQs[stem.id]) {
      stemSettings[stem.id] = {
        ...stemSettings[stem.id],
        eq: carvedEQs[stem.id],
      };
    }
  }
  
  // ─── Mix Bus Configuration ──────────────────────────────────────
  // The mix bus settings here serve as the "glue" compressor and
  // tonal shaping for live playback. The heavy mastering (multiband,
  // limiting, LUFS targeting) is done separately by mastering-chain.ts.
  onProgress?.(50, 'Configuring mix bus...');

  let avgCrest = 12;
  let overallCorrelation = 1;
  const allFreqBalances = analysis.map((a) => a.freqBalance);

  if (analysis.length > 0) {
    avgCrest = analysis.reduce((sum, a) => sum + a.crestFactor, 0) / analysis.length;
  }

  const loudestStem = stems.reduce<Stem | null>((best, s) => {
    if (!s.audioBuffer) return best;
    if (!best || !best.audioBuffer) return s;
    return getPeak(s.audioBuffer) > getPeak(best.audioBuffer) ? s : best;
  }, null);

  if (loudestStem?.audioBuffer) {
    overallCorrelation = getStereoCorrelation(loudestStem.audioBuffer);
  }

  onProgress?.(60, 'Setting mix bus EQ...');

  const avgFreq = allFreqBalances.reduce(
    (acc, fb) => ({ low: acc.low + fb.low, mid: acc.mid + fb.mid, high: acc.high + fb.high }),
    { low: 0, mid: 0, high: 0 }
  );
  const n = allFreqBalances.length || 1;
  avgFreq.low /= n;
  avgFreq.mid /= n;
  avgFreq.high /= n;

  // Mix bus EQ: gentle tonal polish — stems are already treated, so keep this subtle
  const masterEQ: EQBand[] = [
    { frequency: 30, gain: -6, Q: 0.7, type: 'highpass' },
    { frequency: 70, gain: avgFreq.low > 0.55 ? -1.5 : avgFreq.low < 0.3 ? 1.0 : 0.3, Q: 0.7, type: 'lowshelf' },
    { frequency: 280, gain: avgFreq.low > 0.48 ? -1.5 : -0.5, Q: 1.4, type: 'peaking' },
    { frequency: 3200, gain: avgFreq.high < 0.2 ? 1.2 : 0.5, Q: 1.0, type: 'peaking' },
    { frequency: 10000, gain: avgFreq.high > 0.45 ? 0.2 : 1.5, Q: 0.7, type: 'highshelf' },
  ];

  onProgress?.(70, 'Setting mix bus compression...');

  // SSL-style bus glue: slow attack, auto-ish release, 1–3 dB GR
  const masterComp: CompressorSettings = {
    threshold: avgCrest > 16 ? -14 : avgCrest > 12 ? -10 : -6,
    ratio: 2.0,
    attack: 0.03,
    release: 0.1,
    knee: 12,
    makeupGain: avgCrest > 14 ? 2 : 1,
  };

  const masterLimiter = { threshold: -1.5, release: 0.08 };

  onProgress?.(80, 'Setting stereo image...');

  const stereoImager = {
    lowWidth: 0.35,
    midWidth: overallCorrelation > 0.85 ? 1.15 : 1.0,
    highWidth: overallCorrelation > 0.85 ? 1.35 : 1.15,
    bassMonoFreq: 100,
    globalWidth: 1.0,
  };

  // Light bus saturation for glue / density
  const masterSat = { drive: 4, mix: 0.12 };

  onProgress?.(90, 'Calculating headroom...');

  // Leave ~6 dB for the separate mastering station
  const avgRms = analysis.length > 0
    ? analysis.reduce((s, a) => s + a.rmsDb, 0) / analysis.length
    : -18;
  const mixBusTarget = -12;
  const masterGain = Math.max(-6, Math.min(10, mixBusTarget - avgRms));

  onProgress?.(95, 'Finalizing mix...');

  const masterSettings: MasterProcessing = {
    eq: masterEQ,
    compressor: masterComp,
    limiter: masterLimiter,
    saturation: masterSat,
    stereoWidth: { width: 1.0 },
    stereoImager: stereoImager,
    gain: masterGain,
    bypass: false,
  };

  onProgress?.(100, 'Auto mix complete!');

  return { stemSettings, masterSettings, analysis };
}

// ─── Single-Track Analysis & Mastering ─────────────────────────────
// Analyzes a full mix and determines optimal mastering chain settings.

export interface TrackAnalysis {
  peakDb: number;
  rmsDb: number;
  crestFactor: number;
  freqBalance: { low: number; mid: number; high: number };
  stereoCorrelation: number;
  estimatedLUFS: number;
  isMono: boolean;
  isClipping: boolean;
  dynamicRange: number;
  spectralTilt: 'bright' | 'neutral' | 'dark';
  densityCategory: 'sparse' | 'moderate' | 'dense' | 'crushed';
}

export interface MasteringRecommendation {
  category: string;
  description: string;
  severity: 'info' | 'suggestion' | 'warning';
}

export interface QuickMasterResult {
  stemProcessing: StemProcessing;
  masterSettings: MasterProcessing;
  analysis: TrackAnalysis;
  recommendations: MasteringRecommendation[];
  separatedStemAnalysis?: AutoMixResult['analysis'];
  masteringStats?: {
    finalLUFS: number;
    truePeak: number;
    pitchCorrected: boolean;
    effectsApplied: boolean;
    beatOptimized: boolean;
    backgroundEnhanced?: boolean;
    backgroundLayers?: string[];
    detectedKey?: string;
    detectedBPM?: number;
    sonicCharacter?: string;
    characterConfidence?: number;
  };
}

function estimateLUFS(buffer: AudioBuffer): number {
  // Gated loudness approximation (BS.1770-style absolute + relative gates).
  // Full K-weighting is in mastering-chain; this is for analysis/recommendations.
  const sr = buffer.sampleRate;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const len = Math.min(L.length, sr * 30);
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

  if (blocks.length === 0) {
    return toDb(getRMS(buffer)) - 0.691;
  }

  const absThresh = Math.pow(10, (-70 + 0.691) / 10);
  let absSum = 0, absCount = 0;
  for (const b of blocks) {
    if (b > absThresh) { absSum += b; absCount++; }
  }
  if (absCount === 0) return -70;
  const absMean = absSum / absCount;
  const relThresh = absMean * 0.1;
  let relSum = 0, relCount = 0;
  for (const b of blocks) {
    if (b > absThresh && b > relThresh) { relSum += b; relCount++; }
  }
  if (relCount === 0) return -70;
  return -0.691 + 10 * Math.log10(relSum / relCount);
}

function getSpectralTilt(freqBalance: { low: number; mid: number; high: number }): 'bright' | 'neutral' | 'dark' {
  // Use energy ratios for tilt detection: more forgiving thresholds
  // to avoid false positives that cause over-correction
  if (freqBalance.high > freqBalance.low * 1.8) return 'bright';
  if (freqBalance.low > freqBalance.high * 2.5) return 'dark';
  return 'neutral';
}

function getDensityCategory(crestFactor: number): 'sparse' | 'moderate' | 'dense' | 'crushed' {
  if (crestFactor > 18) return 'sparse';
  if (crestFactor > 12) return 'moderate';
  if (crestFactor > 6) return 'dense';
  return 'crushed';
}

function generateRecommendations(analysis: TrackAnalysis): MasteringRecommendation[] {
  const recs: MasteringRecommendation[] = [];

  if (analysis.isClipping) {
    recs.push({
      category: 'Levels',
      description: 'Track is clipping (peaks at or above 0 dBFS). Gain has been reduced to create headroom.',
      severity: 'warning',
    });
  }

  if (analysis.estimatedLUFS > -8) {
    recs.push({
      category: 'Loudness',
      description: 'Track is extremely loud. Heavy limiting may cause audible distortion. Consider a more dynamic source mix.',
      severity: 'warning',
    });
  } else if (analysis.estimatedLUFS > -11) {
    recs.push({
      category: 'Loudness',
      description: 'Track is already quite loud. Light mastering applied to preserve dynamics.',
      severity: 'suggestion',
    });
  } else if (analysis.estimatedLUFS < -20) {
    recs.push({
      category: 'Loudness',
      description: 'Track is very quiet. Significant gain and compression applied to bring it up to streaming targets.',
      severity: 'suggestion',
    });
  }

  if (analysis.densityCategory === 'crushed') {
    recs.push({
      category: 'Dynamics',
      description: 'Very limited dynamic range detected. Compression has been backed off to avoid further squashing.',
      severity: 'warning',
    });
  } else if (analysis.densityCategory === 'sparse') {
    recs.push({
      category: 'Dynamics',
      description: 'Highly dynamic material. Moderate compression applied for a more consistent level.',
      severity: 'info',
    });
  }

  if (analysis.spectralTilt === 'bright') {
    recs.push({
      category: 'Frequency Balance',
      description: 'Track leans bright. High frequencies gently attenuated and lows given a slight boost for warmth.',
      severity: 'suggestion',
    });
  } else if (analysis.spectralTilt === 'dark') {
    recs.push({
      category: 'Frequency Balance',
      description: 'Track sounds dark/bass-heavy. Low end tamed and high frequencies lifted for clarity.',
      severity: 'suggestion',
    });
  } else {
    recs.push({
      category: 'Frequency Balance',
      description: 'Frequency balance looks healthy. Subtle corrective EQ applied.',
      severity: 'info',
    });
  }

  if (analysis.isMono) {
    recs.push({
      category: 'Stereo Image',
      description: 'Track is mono. Stereo widening has been kept minimal to avoid artifacts.',
      severity: 'info',
    });
  } else if (analysis.stereoCorrelation < 0.3) {
    recs.push({
      category: 'Stereo Image',
      description: 'Very wide stereo image with low correlation. Width narrowed slightly for mono compatibility.',
      severity: 'suggestion',
    });
  } else if (analysis.stereoCorrelation > 0.95) {
    recs.push({
      category: 'Stereo Image',
      description: 'Stereo image is very narrow. Gentle widening applied to mids and highs.',
      severity: 'suggestion',
    });
  }

  const targetLUFS = -14;
  recs.push({
    category: 'Target',
    description: `Mastering targeted ~${targetLUFS} LUFS integrated (streaming standard). Adjust master gain to taste.`,
    severity: 'info',
  });

  return recs;
}

export function analyzeAndMasterTrack(
  buffer: AudioBuffer,
  onProgress?: (progress: number, message: string) => void
): QuickMasterResult {
  onProgress?.(5, 'Measuring levels...');

  const peak = getPeak(buffer);
  const rms = getRMS(buffer);
  const peakDb = toDb(peak);
  const rmsDb = toDb(rms);
  const crestFactor = getCrestFactor(buffer);
  const isClipping = peak >= 0.9999;

  onProgress?.(15, 'Analyzing frequency spectrum...');

  const freqBalance = getFrequencyBalance(buffer);
  const spectralTilt = getSpectralTilt(freqBalance);

  onProgress?.(30, 'Measuring stereo field...');

  const isMono = buffer.numberOfChannels < 2;
  const stereoCorrelation = isMono ? 1 : getStereoCorrelation(buffer);
  const estimatedLUFS = estimateLUFS(buffer);
  const dynamicRange = crestFactor;
  const densityCategory = getDensityCategory(crestFactor);

  const analysis: TrackAnalysis = {
    peakDb,
    rmsDb,
    crestFactor,
    freqBalance,
    stereoCorrelation,
    estimatedLUFS,
    isMono,
    isClipping,
    dynamicRange,
    spectralTilt,
    densityCategory,
  };

  onProgress?.(45, 'Calculating stem processing...');

  // Stem-level processing: gentle corrective EQ + light dynamics for the full mix
  const stemGain = isClipping ? Math.min(-1, -6 - peakDb) : Math.max(-12, Math.min(6, -6 - peakDb));

  const stemEQ: EQBand[] = [];
  // Sub rumble cleanup
  stemEQ.push({ frequency: 30, gain: -3, Q: 0.7, type: 'highpass' as BiquadFilterType });
  // Corrective mid
  if (freqBalance.mid > 0.5) {
    stemEQ.push({ frequency: 400, gain: -1.5, Q: 1.2, type: 'peaking' as BiquadFilterType });
  }
  // Presence
  if (spectralTilt === 'dark') {
    stemEQ.push({ frequency: 3000, gain: 2, Q: 1.0, type: 'peaking' as BiquadFilterType });
  }

  const stemComp: CompressorSettings =
    densityCategory === 'crushed'
      ? { threshold: -6, ratio: 1.2, attack: 0.02, release: 0.3, knee: 30, makeupGain: 0 }
      : densityCategory === 'dense'
      ? { threshold: -14, ratio: 1.5, attack: 0.012, release: 0.2, knee: 20, makeupGain: 1 }
      : densityCategory === 'moderate'
      ? { threshold: -18, ratio: 2.0, attack: 0.01, release: 0.15, knee: 15, makeupGain: 1.5 }
      : { threshold: -22, ratio: 2.5, attack: 0.008, release: 0.12, knee: 12, makeupGain: 2 };

  const stemProcessing: StemProcessing = {
    eq: stemEQ.length > 0 ? stemEQ : [{ frequency: 1000, gain: 0, Q: 1.0, type: 'peaking' as BiquadFilterType }],
    compressor: stemComp,
    saturation: { drive: 0, mix: 0 },
    gain: stemGain,
    pan: 0,
    mute: false,
    solo: false,
    bypass: false,
  };

  onProgress?.(60, 'Building master EQ...');

  // Spectral-profile-informed master EQ
  const spectral = getSpectralProfile(buffer);
  const masterEQ: EQBand[] = [
    {
      frequency: 40,
      gain: spectral.sub > 0.25 ? -1.5 : spectral.sub < 0.08 ? 1.5 : 0.5,
      Q: 0.7,
      type: 'lowshelf' as BiquadFilterType,
    },
    {
      frequency: 250,
      gain: spectral.lowMid > 0.3 ? -1.0 : 0,
      Q: 1.5,
      type: 'peaking' as BiquadFilterType,
    },
    {
      frequency: 800,
      gain: spectral.mid > 0.35 ? -0.5 : spectral.mid < 0.15 ? 0.5 : 0,
      Q: 1.0,
      type: 'peaking' as BiquadFilterType,
    },
    {
      frequency: 3000,
      gain: spectral.presence < 0.1 ? 1.5 : spectral.presence > 0.3 ? -0.5 : 0.5,
      Q: 1.2,
      type: 'peaking' as BiquadFilterType,
    },
    {
      // Air: use centroid to gauge brightness instead of just tilt
      frequency: 10000,
      gain: spectral.centroid < 800 ? 1.5 : spectral.centroid > 3000 ? -0.5 : 0.5,
      Q: 0.6,
      type: 'highshelf' as BiquadFilterType,
    },
  ];

  onProgress?.(70, 'Setting dynamics...');

  // Master compressor: gentle glue
  const masterComp: CompressorSettings =
    densityCategory === 'crushed'
      ? { threshold: -6, ratio: 1.2, attack: 0.02, release: 0.25, knee: 30, makeupGain: 0 }
      : densityCategory === 'dense'
      ? { threshold: -10, ratio: 1.5, attack: 0.012, release: 0.18, knee: 25, makeupGain: 0.5 }
      : densityCategory === 'moderate'
      ? { threshold: -14, ratio: 1.8, attack: 0.01, release: 0.15, knee: 20, makeupGain: 1 }
      : { threshold: -18, ratio: 2.2, attack: 0.008, release: 0.12, knee: 15, makeupGain: 2 };

  onProgress?.(80, 'Configuring stereo image...');

  const stereoImager = isMono
    ? { lowWidth: 0.5, midWidth: 1.0, highWidth: 1.0, bassMonoFreq: 80, globalWidth: 1.0 }
    : stereoCorrelation > 0.95
    ? { lowWidth: 0.5, midWidth: 1.15, highWidth: 1.4, bassMonoFreq: 80, globalWidth: 1.05 }
    : stereoCorrelation < 0.3
    ? { lowWidth: 0.4, midWidth: 0.9, highWidth: 1.0, bassMonoFreq: 100, globalWidth: 0.95 }
    : { lowWidth: 0.45, midWidth: 1.05, highWidth: 1.25, bassMonoFreq: 80, globalWidth: 1.0 };

  onProgress?.(88, 'Setting limiter & output gain...');

  const masterLimiter = { threshold: -1, release: densityCategory === 'sparse' ? 0.03 : 0.06 };

  const targetLUFS = -14;
  const masterGain = Math.max(-4, Math.min(14, targetLUFS - estimatedLUFS));

  const masterSat: SaturationSettings = { drive: 0, mix: 0 };

  onProgress?.(92, 'Generating recommendations...');

  const recommendations = generateRecommendations(analysis);

  const masterSettings: MasterProcessing = {
    eq: masterEQ,
    compressor: masterComp,
    limiter: masterLimiter,
    saturation: masterSat,
    stereoWidth: { width: 1.0 },
    stereoImager: stereoImager,
    gain: masterGain,
    bypass: false,
  };

  onProgress?.(100, 'Quick Master complete!');

  return { stemProcessing, masterSettings, analysis, recommendations };
}
