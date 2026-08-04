// ─── Background Enhancement Engine ───────────────────────────────
// Generates background vocal harmonies, ambient pads, textural layers,
// and ad-lib echo throws to enrich a track. All generated algorithmically
// from the existing audio — no external samples or APIs needed.
//
// Open source, fully client-side, zero dependencies.

import { BackgroundEnhancementProfile } from './sonic-character';
import { MusicalKey } from './pitch-correction';

export interface BackgroundEnhancementResult {
  buffer: AudioBuffer;
  layers: string[];  // Descriptions of what was added
}

// ─── Key → Frequency Mapping ─────────────────────────────────────

const KEY_BASE_FREQ: Record<string, number> = {
  'C': 261.63, 'C#': 277.18, 'D': 293.66, 'D#': 311.13, 'E': 329.63,
  'F': 349.23, 'F#': 369.99, 'G': 392.00, 'G#': 415.30, 'A': 440.00,
  'A#': 466.16, 'B': 493.88,
};

function semitonesToRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

// ─── Vocal Harmony Generation ────────────────────────────────────
// Pitch-shifts the vocal track by specified intervals to create harmonies.

function generateHarmony(
  vocalData: Float32Array,
  sampleRate: number,
  semitones: number,
  volume: number
): Float32Array {
  const ratio = semitonesToRatio(semitones);
  const len = vocalData.length;
  const output = new Float32Array(len);
  const lastValidSrc = len - 2;

  // Determine how many output samples we can safely generate
  const maxSafeOutput = Math.floor(lastValidSrc / ratio);

  for (let i = 0; i < len; i++) {
    if (i >= maxSafeOutput) {
      // Fade out smoothly over 2048 samples when source runs out
      const fadeLen = Math.min(2048, maxSafeOutput);
      const fadeStart = maxSafeOutput - fadeLen;
      if (i > fadeStart && i < maxSafeOutput) {
        const fade = (maxSafeOutput - i) / fadeLen;
        const srcIdx = i * ratio;
        const srcFloor = Math.floor(srcIdx);
        const frac = srcIdx - srcFloor;
        if (srcFloor + 1 < len) {
          output[i] = (vocalData[srcFloor] * (1 - frac) + vocalData[srcFloor + 1] * frac) * volume * fade;
        }
      }
      continue;
    }

    const srcIdx = i * ratio;
    const srcFloor = Math.floor(srcIdx);
    const frac = srcIdx - srcFloor;

    // Cubic interpolation for smooth quality
    const im1 = Math.max(0, srcFloor - 1);
    const i0 = srcFloor;
    const i1 = Math.min(len - 1, srcFloor + 1);
    const i2 = Math.min(len - 1, srcFloor + 2);

    const x0 = vocalData[im1];
    const x1 = vocalData[i0];
    const x2 = vocalData[i1];
    const x3 = vocalData[i2];

    const c0 = x1;
    const c1 = 0.5 * (x2 - x0);
    const c2 = x0 - 2.5 * x1 + 2 * x2 - 0.5 * x3;
    const c3 = 0.5 * (x3 - x0) + 1.5 * (x1 - x2);

    output[i] = (((c3 * frac + c2) * frac + c1) * frac + c0) * volume;
  }

  // Low-pass filter to soften harmonies (sit behind the lead vocal)
  let prev = 0;
  const coeff = 0.25;
  for (let i = 0; i < len; i++) {
    output[i] = prev + coeff * (output[i] - prev);
    prev = output[i];
  }

  return output;
}

// ─── Ambient Pad Generator ───────────────────────────────────────
// Creates a warm synth pad tuned to the song's key using additive synthesis.

function generateAmbientPad(
  length: number,
  sampleRate: number,
  key: string,
  volume: number,
  brightness: number,
  attackTime: number
): Float32Array {
  const output = new Float32Array(length);
  const baseFreq = KEY_BASE_FREQ[key] || 261.63;

  // Build a chord: root, 3rd (or minor 3rd), 5th, octave
  const freqs = [
    baseFreq / 2,
    baseFreq / 2 * semitonesToRatio(4),  // Major 3rd
    baseFreq / 2 * semitonesToRatio(7),  // 5th
    baseFreq,                              // Octave
  ];

  // Additive synthesis with detuning for warmth
  for (let i = 0; i < length; i++) {
    let sample = 0;
    const t = i / sampleRate;

    for (let f = 0; f < freqs.length; f++) {
      const freq = freqs[f];
      const detune1 = freq * 1.002;
      const detune2 = freq * 0.998;

      // Multiple detuned oscillators per voice for richness
      sample += Math.sin(2 * Math.PI * freq * t) * 0.25;
      sample += Math.sin(2 * Math.PI * detune1 * t) * 0.15;
      sample += Math.sin(2 * Math.PI * detune2 * t) * 0.15;
    }

    // Amplitude envelope (slow attack, sustain, slight drift via LFO)
    const attackSamples = attackTime * sampleRate;
    const envelope = i < attackSamples
      ? (i / attackSamples) * (i / attackSamples) // Quadratic attack
      : 1.0;

    // LFO for subtle movement
    const lfo = 1 + 0.05 * Math.sin(2 * Math.PI * 0.15 * t);

    output[i] = sample * volume * envelope * lfo;
  }

  // Low-pass filter: brightness controls cutoff (0 = very dark, 1 = open)
  const cutoff = 200 + brightness * 4000;
  const rc = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);
  let filtered = 0;
  for (let i = 0; i < length; i++) {
    filtered += alpha * (output[i] - filtered);
    output[i] = filtered;
  }

  return output;
}

// ─── Texture Generator ───────────────────────────────────────────
// Creates ambient noise textures (vinyl crackle, air, shimmer, rain, warm hiss).

function generateTexture(
  length: number,
  sampleRate: number,
  type: BackgroundEnhancementProfile['textureType'],
  volume: number
): Float32Array {
  const output = new Float32Array(length);

  switch (type) {
    case 'vinyl': {
      // Vinyl crackle: sparse random pops + filtered noise floor
      for (let i = 0; i < length; i++) {
        let sample = (Math.random() * 2 - 1) * 0.02; // Noise floor
        if (Math.random() < 0.0003) {
          sample += (Math.random() - 0.5) * 0.6; // Random pop
        }
        output[i] = sample * volume;
      }
      // Band-pass for vintage character
      let bp1 = 0, bp2 = 0;
      const bpCoeff = 0.15;
      for (let i = 0; i < length; i++) {
        bp1 += bpCoeff * (output[i] - bp1);
        bp2 += bpCoeff * (bp1 - bp2);
        output[i] = bp1 - bp2;
      }
      break;
    }

    case 'air': {
      // High-frequency filtered noise for airy shimmer
      for (let i = 0; i < length; i++) {
        output[i] = (Math.random() * 2 - 1) * volume;
      }
      // High-pass filter (only keep high frequencies)
      let hp = 0;
      const hpCoeff = 0.95;
      for (let i = 0; i < length; i++) {
        hp = hpCoeff * (hp + output[i] - (i > 0 ? output[i - 1] : 0));
        output[i] = hp * 0.3;
      }
      break;
    }

    case 'shimmer': {
      // Modulated high-frequency content with slow sweep
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        const sweepFreq = 3000 + 2000 * Math.sin(2 * Math.PI * 0.08 * t);
        const osc = Math.sin(2 * Math.PI * sweepFreq * t);
        const noise = (Math.random() * 2 - 1) * 0.3;
        output[i] = (osc * 0.2 + noise * 0.1) * volume;
      }
      // Gentle LP to tame harshness
      let lp = 0;
      for (let i = 0; i < length; i++) {
        lp += 0.05 * (output[i] - lp);
        output[i] = lp;
      }
      break;
    }

    case 'rain': {
      // Rain-like ambient texture: many tiny droplets + background wash
      for (let i = 0; i < length; i++) {
        let sample = (Math.random() * 2 - 1) * 0.015; // Background
        if (Math.random() < 0.002) {
          // Individual droplet
          const dropLen = Math.floor(sampleRate * 0.003);
          for (let d = 0; d < dropLen && (i + d) < length; d++) {
            const env = 1 - d / dropLen;
            output[i + d] += (Math.random() - 0.5) * 0.4 * env * volume;
          }
        }
        output[i] += sample * volume;
      }
      break;
    }

    case 'warmhiss': {
      // Warm tape hiss: filtered noise with low-mid presence
      for (let i = 0; i < length; i++) {
        output[i] = (Math.random() * 2 - 1) * volume;
      }
      // Band-pass centered around 2kHz for tape character
      let bp = 0;
      const bpAlpha = 0.08;
      for (let i = 0; i < length; i++) {
        bp += bpAlpha * (output[i] - bp);
        output[i] = bp * 0.5;
      }
      break;
    }
  }

  return output;
}

// ─── Ad-lib / Echo Throw Generator ──────────────────────────────
// Takes vocal fragments and creates panned, delayed echo throws.

function generateAdlibs(
  vocalData: Float32Array,
  sampleRate: number,
  volume: number
): Float32Array {
  const len = vocalData.length;
  const output = new Float32Array(len);

  const delaySamples = Math.floor(sampleRate * 0.35);
  const decayRate = 0.5;

  let env = 0;
  const attCoeff = 1 - Math.exp(-1 / (sampleRate * 0.01));
  const relCoeff = 1 - Math.exp(-1 / (sampleRate * 0.08));

  const peakPositions: number[] = [];
  let lastPeak = -sampleRate * 2;

  for (let i = 0; i < len; i++) {
    const abs = Math.abs(vocalData[i]);
    env += (abs > env ? attCoeff : relCoeff) * (abs - env);

    if (env > 0.15 && (i - lastPeak) > sampleRate * 2) {
      peakPositions.push(i);
      lastPeak = i;
    }
  }

  // Generate smooth echo throws with proper fade envelopes
  for (const pos of peakPositions) {
    const fragmentLen = Math.min(Math.floor(sampleRate * 0.25), len - pos);
    if (fragmentLen < sampleRate * 0.05) continue;

    // Smooth the source fragment edges with a raised-cosine window
    const fadeInLen = Math.floor(fragmentLen * 0.08);
    const fadeOutLen = Math.floor(fragmentLen * 0.35);

    for (let rep = 1; rep <= 2; rep++) {
      const destStart = pos + delaySamples * rep;
      if (destStart + fragmentLen >= len) break;

      const gain = volume * Math.pow(decayRate, rep);
      for (let j = 0; j < fragmentLen; j++) {
        // Raised cosine fade-in and fade-out to prevent clicks
        let envelope = 1;
        if (j < fadeInLen) {
          envelope = 0.5 * (1 - Math.cos(Math.PI * j / fadeInLen));
        } else if (j > fragmentLen - fadeOutLen) {
          envelope = 0.5 * (1 + Math.cos(Math.PI * (j - (fragmentLen - fadeOutLen)) / fadeOutLen));
        }
        output[destStart + j] += vocalData[pos + j] * gain * envelope;
      }
    }
  }

  // Gentle high-pass to keep ad-libs out of the low end (smooth filter)
  let hp1 = 0, hp2 = 0;
  const hpCoeff = 1 - Math.exp(-2 * Math.PI * 200 / sampleRate);
  for (let i = 0; i < len; i++) {
    hp1 += hpCoeff * (output[i] - hp1);
    hp2 += hpCoeff * (hp1 - hp2);
    output[i] = output[i] - hp2;
  }

  return output;
}

// ─── Main Background Enhancement Function ────────────────────────

export async function applyBackgroundEnhancement(
  vocalsBuffer: AudioBuffer,
  fullBuffer: AudioBuffer,
  profile: BackgroundEnhancementProfile,
  detectedKey: string,
  onProgress?: (progress: number, message: string) => void
): Promise<BackgroundEnhancementResult> {
  const sr = vocalsBuffer.sampleRate;
  const len = fullBuffer.length;
  const isStereo = fullBuffer.numberOfChannels >= 2;
  const layers: string[] = [];

  const outputL = new Float32Array(len);
  const outputR = new Float32Array(len);

  // Get vocal mono for processing
  const vocalMono = vocalsBuffer.getChannelData(0);

  let progressBase = 0;

  // ── Vocal Harmonies ─────────────────────────────────────────────
  if (profile.harmonies && profile.harmonyIntervals.length > 0 && profile.harmonyVolume > 0) {
    onProgress?.(5, 'Generating vocal harmonies...');
    await new Promise((r) => setTimeout(r, 0));

    for (let idx = 0; idx < profile.harmonyIntervals.length; idx++) {
      const interval = profile.harmonyIntervals[idx];
      const harmony = generateHarmony(vocalMono, sr, interval, profile.harmonyVolume);

      // Pan harmonies to alternate sides for width
      const panAngle = idx % 2 === 0 ? 0.6 : -0.6;
      const gainL = Math.cos((panAngle + 1) * Math.PI / 4);
      const gainR = Math.sin((panAngle + 1) * Math.PI / 4);

      for (let i = 0; i < Math.min(harmony.length, len); i++) {
        outputL[i] += harmony[i] * gainL;
        outputR[i] += harmony[i] * gainR;
      }

      layers.push(`Harmony +${interval} semitones`);
      await new Promise((r) => setTimeout(r, 0));
    }
    progressBase = 30;
  }

  // ── Ambient Pad ─────────────────────────────────────────────────
  if (profile.ambientPad && profile.padVolume > 0) {
    onProgress?.(progressBase + 5, 'Generating ambient pad...');
    await new Promise((r) => setTimeout(r, 0));

    const keyRoot = detectedKey.split(' ')[0] || 'C';
    const pad = generateAmbientPad(len, sr, keyRoot, profile.padVolume, profile.padBrightness, profile.padAttack);

    // Pad goes wide (mostly side)
    for (let i = 0; i < len; i++) {
      outputL[i] += pad[i] * 0.7;
      outputR[i] += pad[i] * 0.7;
    }

    layers.push(`Ambient pad (${keyRoot})`);
    progressBase += 20;
    await new Promise((r) => setTimeout(r, 0));
  }

  // ── Texture Layer ──────────────────────────────────────────────
  if (profile.texture && profile.textureVolume > 0) {
    onProgress?.(progressBase + 5, `Adding ${profile.textureType} texture...`);
    await new Promise((r) => setTimeout(r, 0));

    const texture = generateTexture(len, sr, profile.textureType, profile.textureVolume);

    // Texture goes wide
    for (let i = 0; i < len; i++) {
      outputL[i] += texture[i];
      outputR[i] += texture[i] * (profile.textureType === 'shimmer' ? -1 : 1); // Stereo spread for shimmer
    }

    layers.push(`${profile.textureType} texture`);
    progressBase += 15;
    await new Promise((r) => setTimeout(r, 0));
  }

  // ── Ad-lib Echo Throws ─────────────────────────────────────────
  if (profile.adlibs && profile.adlibVolume > 0) {
    onProgress?.(progressBase + 5, 'Creating vocal ad-lib throws...');
    await new Promise((r) => setTimeout(r, 0));

    const adlibs = generateAdlibs(vocalMono, sr, profile.adlibVolume);

    // Pan ad-libs slightly off-center
    for (let i = 0; i < Math.min(adlibs.length, len); i++) {
      outputL[i] += adlibs[i] * 0.6;
      outputR[i] += adlibs[i] * 0.85;
    }

    layers.push('Vocal echo throws');
    await new Promise((r) => setTimeout(r, 0));
  }

  onProgress?.(95, 'Building enhancement buffer...');
  await new Promise((r) => setTimeout(r, 0));

  // Create output buffer
  const ctx = new OfflineAudioContext(isStereo ? 2 : 1, len, sr);
  const buffer = ctx.createBuffer(isStereo ? 2 : 1, len, sr);
  buffer.copyToChannel(new Float32Array(outputL), 0);
  if (isStereo) buffer.copyToChannel(new Float32Array(outputR), 1);

  onProgress?.(100, 'Background enhancement complete!');

  return { buffer, layers };
}
