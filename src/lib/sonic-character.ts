// ─── Sonic Character Detection & Adaptive Processing ────────────
// Analyzes a track's sonic DNA and determines its character to adapt
// the entire mixing/mastering approach. Inspired by the versatility
// across different production eras.
//
// Characters:
//   anthemic    — Big, wide, layered, cinematic (MBDTF, Graduation)
//   soulful     — Warm, sample-based, vintage, musical (College Dropout, Late Reg)
//   minimal     — Sparse, space-driven, emotional weight (808s, Donda)
//   aggressive  — Distorted, industrial, intentionally harsh (Yeezus)
//   atmospheric — Psychedelic, textured, spacious (KSG, ye)
//   gospel      — Choir energy, uplifting, lo-fi/hi-fi blend (TLOP, Donda)
//   moody       — Dark R&B, ambient pads, vocal-forward, filtered textures (Take Care, NWTS)
//   hitmaker    — Radio-ready, clean, catchy, balanced, punchy yet smooth (Views, CLB, Scorpion)

import { BeatOptimizeSettings, defaultBeatSettings } from './beat-optimizer';
import { VocalEffectsSettings, defaultVocalEffects } from './vocal-effects';
import { PitchCorrectionSettings, defaultPitchSettings } from './pitch-correction';
import { CinematicSettings, defaultCinematicSettings } from './cinematic-enhancer';

export type SonicCharacter = 'anthemic' | 'soulful' | 'minimal' | 'aggressive' | 'atmospheric' | 'gospel' | 'moody' | 'hitmaker';

export interface CharacterAnalysis {
  character: SonicCharacter;
  confidence: number;
  traits: {
    energy: number;         // 0–1: overall loudness/intensity
    density: number;        // 0–1: how "full" the frequency spectrum is
    brightness: number;     // 0–1: high-frequency presence
    warmth: number;         // 0–1: low-mid emphasis
    spaciousness: number;   // 0–1: stereo width + reverberant quality
    transientHardness: number; // 0–1: how aggressive the transients are
    dynamicRange: number;   // 0–1: ratio of peak to RMS (high = dynamic)
    lowEndWeight: number;   // 0–1: sub/bass dominance
  };
}

export interface BackgroundEnhancementProfile {
  harmonies: boolean;           // Generate vocal harmonies (3rd, 5th)
  harmonyVolume: number;        // 0–1: how loud the harmonies are
  harmonyIntervals: number[];   // semitone intervals to generate (e.g., [3, 7] for minor 3rd + 5th)
  ambientPad: boolean;          // Generate ambient synth pad from key
  padVolume: number;            // 0–1
  padBrightness: number;        // 0–1: filter cutoff for pad
  padAttack: number;            // seconds: how slowly pad fades in
  texture: boolean;             // Generate filtered noise / reverse reverb texture
  textureVolume: number;        // 0–1
  textureType: 'vinyl' | 'air' | 'shimmer' | 'rain' | 'warmhiss';
  adlibs: boolean;              // Generate echo-throw ad-lib textures from vocal fragments
  adlibVolume: number;          // 0–1
}

export interface CharacterProcessingProfile {
  beatSettings: BeatOptimizeSettings;
  vocalSettings: VocalEffectsSettings;
  pitchSettings: PitchCorrectionSettings;
  cinematicSettings: CinematicSettings;
  backgroundEnhancement: BackgroundEnhancementProfile;
  masteringApproach: {
    targetLUFS: number;
    truePeakCeiling: number;
    multibandAggression: number;   // 0–1: how hard the multiband comp hits
    stereoWidenAmount: number;     // 0–1: extra stereo widening
    harmonicExcitement: number;    // 0–1: harmonic saturation amount
    lowEndBoost: number;           // dB: sub boost on master
    airBoost: number;              // dB: high shelf boost
    busCompGlue: number;           // 0–1: how much bus comp
    analogWarmth: number;          // 0–1: tape/console saturation
  };
}

// ─── Character Detection ─────────────────────────────────────────

export function detectSonicCharacter(buffer: AudioBuffer): CharacterAnalysis {
  const sr = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const len = Math.min(data.length, sr * 20); // Analyze up to 20 seconds

  // === Energy (RMS level) ===
  let rmsSum = 0;
  for (let i = 0; i < len; i++) rmsSum += data[i] * data[i];
  const rms = Math.sqrt(rmsSum / len);
  const energy = Math.min(1, rms * 6); // Normalize to 0–1

  // === Peak / Dynamic Range ===
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
  }
  const crestDb = peak > 0 && rms > 0 ? 20 * Math.log10(peak / rms) : 12;
  const dynamicRange = Math.min(1, Math.max(0, (crestDb - 3) / 20));

  // === Frequency balance ===
  let lowEnergy = 0, midEnergy = 0, highEnergy = 0;
  const hopLen = Math.min(len, sr * 10);
  for (let i = 2; i < hopLen; i++) {
    const smooth = (data[i] + data[i - 1] + data[i - 2]) / 3;
    lowEnergy += smooth * smooth;
    const diff = data[i] - data[i - 1];
    highEnergy += diff * diff;
    const midDiff = data[i] - data[i - 2];
    midEnergy += midDiff * midDiff;
  }
  const totalFreqEnergy = lowEnergy + midEnergy + highEnergy || 1;
  const lowRatio = lowEnergy / totalFreqEnergy;
  const midRatio = midEnergy / totalFreqEnergy;
  const highRatio = highEnergy / totalFreqEnergy;

  const brightness = Math.min(1, highRatio * 3);
  const warmth = Math.min(1, (lowRatio + midRatio * 0.3) * 2);
  const lowEndWeight = Math.min(1, lowRatio * 2.5);

  // === Density (how much of the spectrum is active) ===
  const density = Math.min(1, energy * 1.5 + (1 - dynamicRange) * 0.5);

  // === Transient Hardness ===
  let transientCount = 0;
  let env = 0;
  const attCoeff = 1 - Math.exp(-1 / (sr * 0.0005));
  const relCoeff = 1 - Math.exp(-1 / (sr * 0.02));
  const minGap = Math.floor(sr * 0.05);
  let lastOnset = -minGap;

  for (let i = 1; i < Math.min(len, sr * 5); i++) {
    const abs = Math.abs(data[i]);
    env += (abs > env ? attCoeff : relCoeff) * (abs - env);
    if (i > 100 && env - Math.abs(data[i - 100]) * 0.5 > 0.05 && (i - lastOnset) > minGap) {
      transientCount++;
      lastOnset = i;
    }
  }
  const transientDensity = Math.min(1, transientCount / 60); // Normalized to ~5 seconds
  const transientHardness = Math.min(1, transientDensity * 0.6 + (1 - dynamicRange) * 0.4);

  // === Spaciousness (stereo width + reverberant quality) ===
  let spaciousness = 0;
  if (buffer.numberOfChannels >= 2) {
    const R = buffer.getChannelData(1);
    const sampleLen = Math.min(len, sr * 5);
    let diffEnergy = 0, sumEnergy = 0;
    for (let i = 0; i < sampleLen; i++) {
      const d = data[i] - R[i];
      const s = data[i] + R[i];
      diffEnergy += d * d;
      sumEnergy += s * s;
    }
    spaciousness = sumEnergy > 0 ? Math.min(1, (diffEnergy / sumEnergy) * 3) : 0;
  }
  // Also factor in dynamic range (spacious tracks tend to be more dynamic)
  spaciousness = Math.min(1, spaciousness * 0.7 + dynamicRange * 0.3);

  const traits = {
    energy,
    density,
    brightness,
    warmth,
    spaciousness,
    transientHardness,
    dynamicRange,
    lowEndWeight,
  };

  // === Character Classification ===
  const scores: Record<SonicCharacter, number> = {
    anthemic: 0,
    soulful: 0,
    minimal: 0,
    aggressive: 0,
    atmospheric: 0,
    gospel: 0,
    moody: 0,
    hitmaker: 0,
  };

  // Anthemic: high energy, high density, wide, bright, big low end
  scores.anthemic = energy * 0.3 + density * 0.25 + spaciousness * 0.2 + brightness * 0.15 + lowEndWeight * 0.1;

  // Soulful: warm, moderate energy, musical dynamics, not too bright
  scores.soulful = warmth * 0.35 + (1 - brightness) * 0.2 + dynamicRange * 0.2 + (1 - transientHardness) * 0.15 + energy * 0.1;

  // Minimal: low density, high dynamic range, spacious, controlled energy
  scores.minimal = (1 - density) * 0.35 + dynamicRange * 0.25 + spaciousness * 0.2 + (1 - energy) * 0.1 + lowEndWeight * 0.1;

  // Aggressive: hard transients, high energy, bright or harsh, dense
  scores.aggressive = transientHardness * 0.3 + energy * 0.25 + brightness * 0.2 + density * 0.15 + (1 - dynamicRange) * 0.1;

  // Atmospheric: spacious, moderate brightness, dynamic, textured
  scores.atmospheric = spaciousness * 0.35 + dynamicRange * 0.25 + (1 - transientHardness) * 0.2 + brightness * 0.1 + (1 - density) * 0.1;

  // Gospel: warm, dynamic, moderate-high energy, spacious, low-end presence
  scores.gospel = warmth * 0.25 + dynamicRange * 0.2 + energy * 0.2 + spaciousness * 0.2 + lowEndWeight * 0.15;

  // Moody: spacious, warm, NOT bright, moderate energy, soft transients (40-style R&B)
  scores.moody = spaciousness * 0.25 + warmth * 0.25 + (1 - brightness) * 0.2 + (1 - transientHardness) * 0.15 + dynamicRange * 0.15;

  // Hitmaker: balanced energy, moderate density, clean (not too warm/bright), punchy but smooth
  const toneBalance = 1 - Math.abs(brightness - 0.5) * 2; // Peaks at 0.5 brightness
  const energyBalance = 1 - Math.abs(energy - 0.6) * 2.5; // Peaks at moderate-high
  scores.hitmaker = toneBalance * 0.25 + energyBalance * 0.2 + (1 - dynamicRange) * 0.2 + density * 0.15 + transientHardness * 0.1 + lowEndWeight * 0.1;

  // Find winning character
  let bestChar: SonicCharacter = 'anthemic';
  let bestScore = -Infinity;
  for (const [char, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestChar = char as SonicCharacter;
    }
  }

  // Confidence: how much the winner leads the pack
  const sortedScores = Object.values(scores).sort((a, b) => b - a);
  const confidence = sortedScores.length > 1
    ? Math.min(1, (sortedScores[0] - sortedScores[1]) * 5 + 0.5)
    : 0.5;

  return { character: bestChar, confidence, traits };
}

// ─── Character → Processing Profile Mapping ─────────────────────

export function getProcessingProfile(character: SonicCharacter, traits: CharacterAnalysis['traits']): CharacterProcessingProfile {
  switch (character) {
    case 'anthemic':
      return {
        beatSettings: { ...defaultBeatSettings, kickPunch: 65, kickSub: 55, snareCrack: 60, snareBody: 50, hatCrisp: 50, hatSoft: 5, overallPunch: 55, transientAttack: 55, groove: 15 },
        vocalSettings: { deEsser: 42, reverb: 8, reverbSize: 25, reverbDamping: 62, delay: 5, delayTime: 140, delayFeedback: 12, chorus: 0, exciter: 12, warmth: 15 },
        pitchSettings: { ...defaultPitchSettings, speed: 25, strength: 32, humanize: 60, formantPreserve: 85 },
        cinematicSettings: { depth: 20, width: 22, impact: 15, dynamics: 18, warmth: 10, shimmer: 18, presence: 18 },
        backgroundEnhancement: { harmonies: true, harmonyVolume: 0.06, harmonyIntervals: [4, 7], ambientPad: true, padVolume: 0.04, padBrightness: 0.5, padAttack: 2.0, texture: true, textureVolume: 0.02, textureType: 'shimmer', adlibs: true, adlibVolume: 0.04 },
        masteringApproach: { targetLUFS: -12, truePeakCeiling: -0.5, multibandAggression: 0.5, stereoWidenAmount: 0.5, harmonicExcitement: 0.35, lowEndBoost: 1.0, airBoost: 1.5, busCompGlue: 0.55, analogWarmth: 0.4 },
      };

    case 'soulful':
      return {
        beatSettings: { ...defaultBeatSettings, kickPunch: 50, kickSub: 45, snareCrack: 45, snareBody: 55, hatCrisp: 30, hatSoft: 35, overallPunch: 40, transientAttack: 30, groove: 20 },
        vocalSettings: { deEsser: 38, reverb: 10, reverbSize: 28, reverbDamping: 58, delay: 6, delayTime: 150, delayFeedback: 14, chorus: 0, exciter: 10, warmth: 20 },
        pitchSettings: { ...defaultPitchSettings, speed: 15, strength: 25, humanize: 75, formantPreserve: 90 },
        cinematicSettings: { depth: 12, width: 12, impact: 8, dynamics: 12, warmth: 15, shimmer: 10, presence: 15 },
        backgroundEnhancement: { harmonies: true, harmonyVolume: 0.05, harmonyIntervals: [3, 7], ambientPad: false, padVolume: 0, padBrightness: 0.3, padAttack: 1.0, texture: true, textureVolume: 0.02, textureType: 'vinyl', adlibs: false, adlibVolume: 0 },
        masteringApproach: { targetLUFS: -13, truePeakCeiling: -1, multibandAggression: 0.3, stereoWidenAmount: 0.25, harmonicExcitement: 0.25, lowEndBoost: 0.5, airBoost: 0.5, busCompGlue: 0.45, analogWarmth: 0.6 },
      };

    case 'minimal':
      return {
        beatSettings: { ...defaultBeatSettings, kickPunch: 50, kickSub: 70, snareCrack: 45, snareBody: 35, hatCrisp: 35, hatSoft: 25, overallPunch: 30, transientAttack: 40, groove: 0 },
        vocalSettings: { deEsser: 40, reverb: 6, reverbSize: 22, reverbDamping: 65, delay: 4, delayTime: 130, delayFeedback: 12, chorus: 0, exciter: 12, warmth: 12 },
        pitchSettings: { ...defaultPitchSettings, speed: 28, strength: 30, humanize: 60, formantPreserve: 85 },
        cinematicSettings: { depth: 18, width: 18, impact: 12, dynamics: 20, warmth: 8, shimmer: 15, presence: 12 },
        backgroundEnhancement: { harmonies: false, harmonyVolume: 0, harmonyIntervals: [], ambientPad: true, padVolume: 0.03, padBrightness: 0.3, padAttack: 3.0, texture: true, textureVolume: 0.02, textureType: 'air', adlibs: true, adlibVolume: 0.04 },
        masteringApproach: { targetLUFS: -13, truePeakCeiling: -0.5, multibandAggression: 0.35, stereoWidenAmount: 0.35, harmonicExcitement: 0.15, lowEndBoost: 1.5, airBoost: 0.8, busCompGlue: 0.35, analogWarmth: 0.25 },
      };

    case 'aggressive':
      return {
        beatSettings: { ...defaultBeatSettings, kickPunch: 80, kickSub: 65, snareCrack: 75, snareBody: 40, hatCrisp: 60, hatSoft: 0, overallPunch: 70, transientAttack: 75, groove: 40 },
        vocalSettings: { deEsser: 25, reverb: 4, reverbSize: 18, reverbDamping: 70, delay: 2, delayTime: 110, delayFeedback: 10, chorus: 0, exciter: 15, warmth: 10 },
        pitchSettings: { ...defaultPitchSettings, speed: 30, strength: 28, humanize: 50, formantPreserve: 75 },
        cinematicSettings: { depth: 8, width: 15, impact: 18, dynamics: 12, warmth: 6, shimmer: 6, presence: 15 },
        backgroundEnhancement: { harmonies: false, harmonyVolume: 0, harmonyIntervals: [], ambientPad: false, padVolume: 0, padBrightness: 0, padAttack: 0, texture: false, textureVolume: 0, textureType: 'air', adlibs: false, adlibVolume: 0 },
        masteringApproach: { targetLUFS: -10, truePeakCeiling: -0.3, multibandAggression: 0.65, stereoWidenAmount: 0.4, harmonicExcitement: 0.5, lowEndBoost: 1.5, airBoost: 2.0, busCompGlue: 0.65, analogWarmth: 0.2 },
      };

    case 'atmospheric':
      return {
        beatSettings: { ...defaultBeatSettings, kickPunch: 35, kickSub: 45, snareCrack: 30, snareBody: 40, hatCrisp: 30, hatSoft: 45, overallPunch: 25, transientAttack: 20, groove: 10 },
        vocalSettings: { deEsser: 40, reverb: 10, reverbSize: 32, reverbDamping: 58, delay: 7, delayTime: 170, delayFeedback: 15, chorus: 0, exciter: 10, warmth: 15 },
        pitchSettings: { ...defaultPitchSettings, speed: 14, strength: 22, humanize: 78, formantPreserve: 90 },
        cinematicSettings: { depth: 22, width: 22, impact: 10, dynamics: 18, warmth: 12, shimmer: 20, presence: 12 },
        backgroundEnhancement: { harmonies: true, harmonyVolume: 0.05, harmonyIntervals: [7, 12], ambientPad: true, padVolume: 0.04, padBrightness: 0.45, padAttack: 4.0, texture: true, textureVolume: 0.03, textureType: 'shimmer', adlibs: true, adlibVolume: 0.03 },
        masteringApproach: { targetLUFS: -14, truePeakCeiling: -1, multibandAggression: 0.25, stereoWidenAmount: 0.6, harmonicExcitement: 0.2, lowEndBoost: 0.5, airBoost: 1.2, busCompGlue: 0.25, analogWarmth: 0.4 },
      };

    case 'gospel':
      return {
        beatSettings: { ...defaultBeatSettings, kickPunch: 50, kickSub: 50, snareCrack: 50, snareBody: 50, hatCrisp: 38, hatSoft: 25, overallPunch: 45, transientAttack: 40, groove: 18 },
        vocalSettings: { deEsser: 42, reverb: 10, reverbSize: 35, reverbDamping: 55, delay: 6, delayTime: 160, delayFeedback: 14, chorus: 0, exciter: 12, warmth: 18 },
        pitchSettings: { ...defaultPitchSettings, speed: 18, strength: 28, humanize: 68, formantPreserve: 88 },
        cinematicSettings: { depth: 18, width: 18, impact: 12, dynamics: 15, warmth: 12, shimmer: 15, presence: 18 },
        backgroundEnhancement: { harmonies: true, harmonyVolume: 0.07, harmonyIntervals: [3, 7, 12], ambientPad: true, padVolume: 0.04, padBrightness: 0.35, padAttack: 2.5, texture: false, textureVolume: 0, textureType: 'air', adlibs: true, adlibVolume: 0.04 },
        masteringApproach: { targetLUFS: -13, truePeakCeiling: -0.5, multibandAggression: 0.4, stereoWidenAmount: 0.45, harmonicExcitement: 0.3, lowEndBoost: 0.8, airBoost: 1.2, busCompGlue: 0.45, analogWarmth: 0.5 },
      };

    case 'moody':
      return {
        beatSettings: { ...defaultBeatSettings, kickPunch: 42, kickSub: 58, snareCrack: 38, snareBody: 48, hatCrisp: 28, hatSoft: 40, overallPunch: 35, transientAttack: 25, groove: 10 },
        vocalSettings: { deEsser: 42, reverb: 9, reverbSize: 30, reverbDamping: 60, delay: 6, delayTime: 160, delayFeedback: 14, chorus: 0, exciter: 10, warmth: 18 },
        pitchSettings: { ...defaultPitchSettings, speed: 20, strength: 28, humanize: 65, formantPreserve: 85 },
        cinematicSettings: { depth: 20, width: 18, impact: 12, dynamics: 18, warmth: 15, shimmer: 12, presence: 15 },
        backgroundEnhancement: { harmonies: true, harmonyVolume: 0.05, harmonyIntervals: [3, 7], ambientPad: true, padVolume: 0.04, padBrightness: 0.3, padAttack: 3.5, texture: true, textureVolume: 0.02, textureType: 'rain', adlibs: true, adlibVolume: 0.04 },
        masteringApproach: { targetLUFS: -13, truePeakCeiling: -0.5, multibandAggression: 0.35, stereoWidenAmount: 0.45, harmonicExcitement: 0.25, lowEndBoost: 1.0, airBoost: 0.8, busCompGlue: 0.4, analogWarmth: 0.5 },
      };

    case 'hitmaker':
      return {
        beatSettings: { ...defaultBeatSettings, kickPunch: 60, kickSub: 55, snareCrack: 55, snareBody: 45, hatCrisp: 50, hatSoft: 8, overallPunch: 55, transientAttack: 50, groove: 25 },
        vocalSettings: { deEsser: 45, reverb: 7, reverbSize: 24, reverbDamping: 63, delay: 4, delayTime: 140, delayFeedback: 12, chorus: 0, exciter: 14, warmth: 15 },
        pitchSettings: { ...defaultPitchSettings, speed: 24, strength: 32, humanize: 58, formantPreserve: 82 },
        cinematicSettings: { depth: 15, width: 18, impact: 12, dynamics: 12, warmth: 10, shimmer: 14, presence: 18 },
        backgroundEnhancement: { harmonies: true, harmonyVolume: 0.06, harmonyIntervals: [4, 7], ambientPad: true, padVolume: 0.03, padBrightness: 0.45, padAttack: 1.5, texture: true, textureVolume: 0.015, textureType: 'warmhiss', adlibs: true, adlibVolume: 0.05 },
        masteringApproach: { targetLUFS: -11, truePeakCeiling: -0.5, multibandAggression: 0.5, stereoWidenAmount: 0.45, harmonicExcitement: 0.35, lowEndBoost: 1.0, airBoost: 1.2, busCompGlue: 0.55, analogWarmth: 0.35 },
      };
  }
}
