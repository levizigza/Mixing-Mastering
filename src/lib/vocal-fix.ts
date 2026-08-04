// ─── Vocal Fix Station ───────────────────────────────────────────
// Studio vocal repair + mix chain inspired by iZotope / Waves / Antares:
//   1. Cleanup (noise gate / denoise / plosive tame)
//   2. Light transparent pitch correction
//   3. Corrective EQ (HPF, mud, presence)
//   4. Compression (level syllables)
//   5. De-ess
//   6. Subtle saturation / air
//   7. Light space (short plate-ish reverb)
//   8. Output level for mix readiness

import {
  correctPitch,
  detectKey,
  PitchCorrectionSettings,
} from './pitch-correction';
import { applyVocalEffects, VocalEffectsSettings } from './vocal-effects';

export interface VocalFixResult {
  buffer: AudioBuffer;
  key: string;
  scale: string;
  notes: string[];
  stages: string[];
}

function createBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const ctx = new OfflineAudioContext(channels.length, channels[0].length, sampleRate);
  const buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
  for (let ch = 0; ch < channels.length; ch++) {
    buf.copyToChannel(new Float32Array(channels[ch]), ch);
  }
  return buf;
}

async function applyBiquad(
  buffer: AudioBuffer,
  type: BiquadFilterType,
  frequency: number,
  Q: number,
  gain: number
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = Q;
  if (type === 'peaking' || type === 'lowshelf' || type === 'highshelf') {
    filter.gain.value = gain;
  }
  source.connect(filter);
  filter.connect(ctx.destination);
  source.start();
  return ctx.startRendering();
}

/** Soft noise gate — cuts bedroom noise / idle hiss between phrases (iZotope cleanup). */
function noiseGate(data: Float32Array, sr: number, thresholdDb: number): Float32Array {
  const out = new Float32Array(data.length);
  const thr = Math.pow(10, thresholdDb / 20);
  const attack = 1 - Math.exp(-1 / (sr * 0.005));
  const release = 1 - Math.exp(-1 / (sr * 0.08));
  let env = 0;
  let gain = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    env += (abs > env ? attack : release) * (abs - env);
    const target = env > thr ? 1 : 0.08;
    gain += (target > gain ? attack : release) * (target - gain);
    out[i] = data[i] * gain;
  }
  return out;
}

/** Soften plosives — short low-frequency peaks (p/b pops). */
function tamePlosives(data: Float32Array, sr: number): Float32Array {
  const out = new Float32Array(data.length);
  // Crude low content via one-pole LP
  let lp = 0;
  const coeff = Math.exp(-2 * Math.PI * 120 / sr);
  const attack = 1 - Math.exp(-1 / (sr * 0.001));
  const release = 1 - Math.exp(-1 / (sr * 0.04));
  let env = 0;
  for (let i = 0; i < data.length; i++) {
    lp = data[i] * (1 - coeff) + lp * coeff;
    const abs = Math.abs(lp);
    env += (abs > env ? attack : release) * (abs - env);
    let g = 1;
    if (env > 0.25) {
      g = Math.max(0.45, 0.25 / env);
    }
    out[i] = data[i] * g;
  }
  return out;
}

function compressVocal(data: Float32Array, sr: number): Float32Array {
  const out = new Float32Array(data.length);
  const thr = Math.pow(10, -18 / 20);
  const ratio = 3.5;
  const attack = 1 - Math.exp(-1 / (sr * 0.008));
  const release = 1 - Math.exp(-1 / (sr * 0.1));
  let env = 0;
  let gr = 1;
  const makeup = Math.pow(10, 2.5 / 20);
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    env += (abs > env ? attack : release) * (abs - env);
    let target = 1;
    if (env > thr) {
      const over = 20 * Math.log10(env / thr);
      target = Math.pow(10, -(over - over / ratio) / 20);
    }
    gr += (target < gr ? attack : release) * (target - gr);
    out[i] = data[i] * gr * makeup;
  }
  return out;
}

function softSaturate(data: Float32Array, drive: number): Float32Array {
  if (drive <= 0.01) return data;
  const out = new Float32Array(data.length);
  const d = 1 + drive * 1.8;
  const mix = drive * 0.25;
  for (let i = 0; i < data.length; i++) {
    const wet = Math.tanh(data[i] * d) / d;
    out[i] = data[i] * (1 - mix) + wet * mix;
  }
  return out;
}

function levelVocal(buffer: AudioBuffer): AudioBuffer {
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      sum += d[i] * d[i];
      count++;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, count));
  const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -60;
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -60;
  let gainDb = -14 - rmsDb; // vocal slightly forward
  if (peakDb + gainDb > -4) gainDb = -4 - peakDb;
  gainDb = Math.max(-12, Math.min(14, gainDb));
  const g = Math.pow(10, gainDb / 20);
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) {
      const x = src[i] * g;
      out[i] = Math.abs(x) > 0.95 ? Math.sign(x) * (0.95 + (Math.abs(x) - 0.95) / (1 + (Math.abs(x) - 0.95) * 3)) : x;
    }
    channels.push(out);
  }
  return createBuffer(channels, buffer.sampleRate);
}

/**
 * Full vocal-fix pass for a dry (or mostly dry) vocal take.
 */
export async function runVocalFixStation(
  buffer: AudioBuffer,
  onProgress?: (progress: number, message: string) => void
): Promise<VocalFixResult> {
  const stages: string[] = [];
  const notes: string[] = [];
  const sr = buffer.sampleRate;

  onProgress?.(4, 'Cleaning noise & plosives...');
  await new Promise((r) => setTimeout(r, 0));
  {
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      let d: Float32Array = new Float32Array(buffer.getChannelData(ch));
      d = new Float32Array(noiseGate(d, sr, -42));
      d = new Float32Array(tamePlosives(d, sr));
      channels.push(d);
    }
    buffer = createBuffer(channels, sr);
    stages.push('Cleanup');
    notes.push('Gated noise floor and tamed plosive pops.');
  }

  onProgress?.(18, 'Detecting key...');
  const detected = detectKey(buffer);
  const pitchSettings: PitchCorrectionSettings = {
    speed: 28,
    strength: 38,
    key: detected.key,
    scale: detected.scale === 'chromatic' ? 'major' : detected.scale,
    humanize: 55,
    formantPreserve: 88,
  };
  notes.push(`Transparent pitch in ${detected.key} ${pitchSettings.scale}.`);

  onProgress?.(24, 'Transparent pitch correction...');
  buffer = await correctPitch(buffer, pitchSettings, (p, m) => {
    onProgress?.(24 + p * 0.28, m);
  });
  stages.push('Pitch');

  onProgress?.(55, 'Corrective EQ...');
  await new Promise((r) => setTimeout(r, 0));
  buffer = await applyBiquad(buffer, 'highpass', 90, 0.707, 0);
  buffer = await applyBiquad(buffer, 'peaking', 220, 1.4, -2.5); // mud
  buffer = await applyBiquad(buffer, 'peaking', 3500, 1.2, 2.0); // presence
  buffer = await applyBiquad(buffer, 'highshelf', 10000, 0.7, 1.2); // air
  stages.push('EQ');
  notes.push('HPF + mud cut + presence/air for clarity.');

  onProgress?.(66, 'Compressing dynamics...');
  await new Promise((r) => setTimeout(r, 0));
  {
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      channels.push(compressVocal(new Float32Array(buffer.getChannelData(ch)), sr));
    }
    buffer = createBuffer(channels, sr);
    stages.push('Compression');
    notes.push('3.5:1 optical-style compression for even syllables.');
  }

  onProgress?.(76, 'De-essing & polish...');
  await new Promise((r) => setTimeout(r, 0));
  {
    const fx: VocalEffectsSettings = {
      deEsser: 48,
      reverb: 7,
      reverbSize: 18,
      reverbDamping: 68,
      delay: 2,
      delayTime: 120,
      delayFeedback: 8,
      chorus: 0,
      exciter: 12,
      warmth: 14,
    };
    buffer = await applyVocalEffects(buffer, fx, (p) => {
      onProgress?.(76 + p * 0.1, 'De-ess / space...');
    });
    // Extra mild saturation after FX for body
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      channels.push(softSaturate(new Float32Array(buffer.getChannelData(ch)), 0.35));
    }
    buffer = createBuffer(channels, sr);
    stages.push('De-ess · Space · Warmth');
    notes.push('De-essed harsh S’s without dulling; light plate + warmth.');
  }

  onProgress?.(92, 'Levelling vocal...');
  await new Promise((r) => setTimeout(r, 0));
  buffer = levelVocal(buffer);
  stages.push('Level');
  notes.push('Output levelled for mix readiness (~−14 dBFS RMS).');

  onProgress?.(100, 'Vocal fix complete!');
  return {
    buffer,
    key: detected.key,
    scale: pitchSettings.scale,
    notes,
    stages,
  };
}
