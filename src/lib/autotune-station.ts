// ─── Auto-Tune Station ───────────────────────────────────────────
// Intensity ladder from transparent pitch fix → classic hard Auto-Tune.
// Settings map to Antares concepts (Retune Speed / Humanize / Classic):
//   0–20   Natural     — Retune ~25–40 spirit, high humanize (Waves / Antares natural)
//   20–45  Studio      — light polish, Afrobeats-ish clarity
//   45–70  Modern      — audible but musical (Retune ~10–15)
//   70–90  Hard Tune   — obvious robotic snap
//   90–100 T-Pain / Evo — Retune ≈ 0, Humanize ≈ 0, classic brightness

import {
  correctPitch,
  detectKey,
  PitchCorrectionSettings,
  MusicalKey,
  ScaleType,
} from './pitch-correction';

export type AutotuneIntensityLabel =
  | 'Natural'
  | 'Studio'
  | 'Modern'
  | 'Hard Tune'
  | 'T-Pain';

export interface AutotuneStationResult {
  buffer: AudioBuffer;
  intensity: number;
  label: AutotuneIntensityLabel;
  key: MusicalKey;
  scale: ScaleType;
  keyConfidence: number;
  settings: PitchCorrectionSettings;
  notes: string[];
}

export const AUTOTUNE_PRESETS: {
  intensity: number;
  label: AutotuneIntensityLabel;
  description: string;
}[] = [
  { intensity: 15, label: 'Natural', description: 'Transparent pitch fix — keeps vibrato & slides' },
  { intensity: 35, label: 'Studio', description: 'Polished studio correction, still human' },
  { intensity: 55, label: 'Modern', description: 'Audible modern pop / melodic-rap tune' },
  { intensity: 80, label: 'Hard Tune', description: 'Obvious robotic quantization' },
  { intensity: 100, label: 'T-Pain', description: 'Classic Evo / Retune Speed ≈ 0 signature effect' },
];

export function intensityToLabel(intensity: number): AutotuneIntensityLabel {
  if (intensity >= 90) return 'T-Pain';
  if (intensity >= 70) return 'Hard Tune';
  if (intensity >= 45) return 'Modern';
  if (intensity >= 25) return 'Studio';
  return 'Natural';
}

/** Map 0–100 intensity → pitch engine settings (Antares-style). */
export function intensityToPitchSettings(
  intensity: number,
  key: MusicalKey,
  scale: ScaleType
): PitchCorrectionSettings {
  const t = Math.max(0, Math.min(100, intensity)) / 100;

  // Retune Speed spirit: natural 20–50 → T-Pain 0  (our speed is inverted: higher = faster)
  const speed = 18 + t * 82; // 18 … 100
  // Strength: gentle → near-full snap
  const strength = 28 + t * 70; // 28 … 98
  // Humanize: high for natural, 0 for classic effect
  const humanize = Math.max(0, 72 - t * 78); // 72 … 0
  // Formants: preserve on natural; slight classic character on hard
  const formantPreserve = Math.max(40, 90 - t * 35);

  return {
    speed,
    strength,
    key,
    scale: t > 0.55 ? scale : scale === 'chromatic' ? 'major' : scale,
    humanize,
    formantPreserve,
  };
}

async function applyClassicBrightness(buffer: AudioBuffer, amount: number): Promise<AudioBuffer> {
  if (amount < 0.05) return buffer;
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 4500;
  shelf.gain.value = amount * 2.8; // up to ~+2.8 dB classic “edge”
  const peaking = ctx.createBiquadFilter();
  peaking.type = 'peaking';
  peaking.frequency.value = 2800;
  peaking.Q.value = 1.2;
  peaking.gain.value = amount * 1.5;
  source.connect(shelf);
  shelf.connect(peaking);
  peaking.connect(ctx.destination);
  source.start();
  return ctx.startRendering();
}

/**
 * Auto-Tune station: detect key → apply intensity-mapped correction → optional classic color.
 */
export async function runAutotuneStation(
  buffer: AudioBuffer,
  intensity: number,
  onProgress?: (progress: number, message: string) => void,
  keyOverride?: MusicalKey,
  scaleOverride?: ScaleType
): Promise<AutotuneStationResult> {
  const clamped = Math.max(0, Math.min(100, Math.round(intensity)));
  const label = intensityToLabel(clamped);

  onProgress?.(5, 'Detecting key & scale...');
  await new Promise((r) => setTimeout(r, 0));
  const detected = detectKey(buffer);
  const key = keyOverride ?? detected.key;
  const scale = scaleOverride ?? (detected.scale === 'chromatic' ? 'major' : detected.scale);
  const settings = intensityToPitchSettings(clamped, key, scale);

  const notes: string[] = [
    `Intensity ${clamped}/100 — ${label}.`,
    `Key ${key} ${scale} (${Math.round(detected.confidence * 100)}% detected${keyOverride ? ', overridden' : ''}).`,
  ];

  if (label === 'Natural' || label === 'Studio') {
    notes.push('Natural correction: slower retune, high humanize — vibrato & slides kept.');
  } else if (label === 'Modern') {
    notes.push('Modern audible tune — musical quantization without full robot.');
  } else if (label === 'Hard Tune') {
    notes.push('Hard tune: fast retune, low humanize — clearly corrected.');
  } else {
    notes.push('T-Pain / Classic Evo spirit: near-zero retune, humanize off, brighter attack.');
  }

  onProgress?.(15, `Auto-Tune ${label}...`);
  let processed = await correctPitch(buffer, settings, (p, m) => {
    onProgress?.(15 + p * 0.7, m);
  });

  // Classic Mode character at high intensity
  if (clamped >= 70) {
    onProgress?.(90, 'Classic Auto-Tune color...');
    await new Promise((r) => setTimeout(r, 0));
    const classicAmt = (clamped - 70) / 30;
    processed = await applyClassicBrightness(processed, 0.35 + classicAmt * 0.65);
    notes.push('Classic brightness / harder note transitions applied.');
  }

  onProgress?.(100, 'Auto-Tune complete!');
  return {
    buffer: processed,
    intensity: clamped,
    label,
    key,
    scale,
    keyConfidence: detected.confidence,
    settings,
    notes,
  };
}
