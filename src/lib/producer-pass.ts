/**
 * Producer Pass — optional, restrained intangibles polish.
 *
 * Opt-in only. Does NOT stack mud EQ or clarity locks (those live elsewhere).
 * At most: tiny kick-mask duck + light parallel glue, each gated for clarity.
 */

import { detectSonicCharacter, SonicCharacter } from '@/lib/sonic-character';
import { SongSection } from '@/types/audio';
import {
  measureClarity,
  preferClearer,
  signalRms,
  matchRmsLevel,
} from '@/lib/mix-clarity';

export interface ProducerPassResult {
  buffer: AudioBuffer;
  notes: string[];
  listens: number;
  cohesionScore: number;
  character: SonicCharacter;
}

export interface ProducerPassOptions {
  onProgress?: (p: number, m: string) => void;
  intensity?: number;
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const err = new Error('Producer Pass cancelled');
    err.name = 'AbortError';
    throw err;
  }
}

async function yieldToUI() {
  await new Promise<void>((r) => setTimeout(r, 0));
}

function createBuffer(L: Float32Array, R: Float32Array, sr: number, stereo: boolean): AudioBuffer {
  const ctx = new OfflineAudioContext(stereo ? 2 : 1, L.length, sr);
  const buf = ctx.createBuffer(stereo ? 2 : 1, L.length, sr);
  buf.copyToChannel(new Float32Array(L), 0);
  if (stereo) buf.copyToChannel(new Float32Array(R), 1);
  return buf;
}

function lightParallelGlue(
  L: Float32Array,
  R: Float32Array,
  sr: number,
  wet: number
): { L: Float32Array; R: Float32Array } {
  if (wet < 0.03) return { L, R };
  wet = Math.min(0.07, wet);
  const compL = new Float32Array(L.length);
  const compR = new Float32Array(R.length);
  const thresh = 0.38;
  const ratio = 1.45;
  const att = 1 - Math.exp(-1 / (sr * 0.028));
  const rel = 1 - Math.exp(-1 / (sr * 0.28));
  let env = 0;
  for (let i = 0; i < L.length; i++) {
    const mono = (Math.abs(L[i]) + Math.abs(R[i])) * 0.5;
    env += (mono > env ? att : rel) * (mono - env);
    const g = env > thresh ? Math.pow(env / thresh, 1 / ratio - 1) : 1;
    compL[i] = L[i] * g;
    compR[i] = R[i] * g;
  }
  const dryRms = signalRms(L, R);
  const wetRms = signalRms(compL, compR);
  const makeup = wetRms > 1e-8 ? dryRms / wetRms : 1;
  const outL = new Float32Array(L.length);
  const outR = new Float32Array(R.length);
  for (let i = 0; i < L.length; i++) {
    outL[i] = L[i] * (1 - wet) + compL[i] * makeup * wet;
    outR[i] = R[i] * (1 - wet) + compR[i] * makeup * wet;
  }
  return { L: outL, R: outR };
}

/** Duck only 230–380 Hz when kick speaks — no side collapse. */
function kickPocket(
  L: Float32Array,
  R: Float32Array,
  sr: number,
  amount: number
): { L: Float32Array; R: Float32Array } {
  if (amount < 0.05) return { L, R };
  const outL = new Float32Array(L.length);
  const outR = new Float32Array(R.length);
  const aKick = Math.exp((-2 * Math.PI * 85) / sr);
  const aLo = Math.exp((-2 * Math.PI * 230) / sr);
  const aHi = Math.exp((-2 * Math.PI * 380) / sr);
  const att = 1 - Math.exp(-1 / (sr * 0.004));
  const rel = 1 - Math.exp(-1 / (sr * 0.09));
  let kickLp = 0;
  let env = 0;
  let loL = 0,
    hiL = 0,
    loR = 0,
    hiR = 0;
  const maxDuck = 0.08 * amount;

  for (let i = 0; i < L.length; i++) {
    const mid = (L[i] + R[i]) * 0.5;
    kickLp = mid + (kickLp - mid) * aKick;
    const kickAbs = Math.abs(kickLp);
    env += (kickAbs > env ? att : rel) * (kickAbs - env);
    const duck = Math.min(maxDuck, env * amount * 1.2);
    loL = L[i] + (loL - L[i]) * aLo;
    hiL = L[i] + (hiL - L[i]) * aHi;
    loR = R[i] + (loR - R[i]) * aLo;
    hiR = R[i] + (hiR - R[i]) * aHi;
    outL[i] = L[i] - (hiL - loL) * duck;
    outR[i] = R[i] - (hiR - loR) * duck;
  }
  return { L: outL, R: outR };
}

export async function applyProducerPass(
  buffer: AudioBuffer,
  _sections: SongSection[] = [],
  options: ProducerPassOptions = {}
): Promise<ProducerPassResult> {
  const { onProgress, signal } = options;
  const notes: string[] = [];
  const sr = buffer.sampleRate;
  const stereo = buffer.numberOfChannels >= 2;

  throwIfAborted(signal);
  onProgress?.(6, 'Producer Pass: listening...');
  await yieldToUI();

  const analysis = detectSonicCharacter(buffer);
  let intensity =
    typeof options.intensity === 'number'
      ? Math.max(0.2, Math.min(0.45, options.intensity))
      : 0.28 + analysis.traits.energy * 0.08;
  intensity = Math.max(0.22, Math.min(0.4, intensity));

  notes.push(`Producer Pass · ${analysis.character} · intensity ${Math.round(intensity * 100)}%`);
  notes.push('Restrained polish — no mud EQ stack, no clarity re-carve, no arrangement ducking.');

  let current = buffer;
  const baseline = measureClarity(current);
  notes.push(`Baseline mud ${baseline.mudRatio.toFixed(2)} · clarity ${baseline.clarity.toFixed(2)}`);

  // If already clear, do almost nothing (studio restraint)
  if (baseline.mudRatio < 0.85 && baseline.clarity > 0.55) {
    onProgress?.(100, 'Producer Pass: mix already coherent — light touch only');
    notes.push('Mix already coherent — skipped pocket/glue to preserve fidelity.');
    return {
      buffer: current,
      notes,
      listens: 1,
      cohesionScore: baseline.clarity,
      character: analysis.character,
    };
  }

  throwIfAborted(signal);
  onProgress?.(40, 'Producer Pass: kick pocket...');
  await yieldToUI();
  {
    let L = new Float32Array(current.getChannelData(0));
    let R = new Float32Array(stereo ? current.getChannelData(1) : current.getChannelData(0));
    const target = signalRms(L, R);
    const pocketed = kickPocket(L, R, sr, intensity * 0.55);
    L = new Float32Array(pocketed.L);
    R = new Float32Array(pocketed.R);
    matchRmsLevel(L, R, target);
    const gate = preferClearer(createBuffer(L, R, sr, stereo), current);
    current = gate.buffer;
    notes.push(`Kick pocket · ${gate.reason}`);
  }

  throwIfAborted(signal);
  onProgress?.(75, 'Producer Pass: light glue...');
  await yieldToUI();
  {
    let L = new Float32Array(current.getChannelData(0));
    let R = new Float32Array(stereo ? current.getChannelData(1) : current.getChannelData(0));
    const target = signalRms(L, R);
    const glued = lightParallelGlue(L, R, sr, 0.05);
    L = new Float32Array(glued.L);
    R = new Float32Array(glued.R);
    matchRmsLevel(L, R, target);
    const gate = preferClearer(createBuffer(L, R, sr, stereo), current);
    current = gate.buffer;
    notes.push(`Parallel glue · ${gate.reason}`);
  }

  const after = measureClarity(current);
  notes.push(
    `Done · clarity ${baseline.clarity.toFixed(2)} → ${after.clarity.toFixed(2)} · mud ${baseline.mudRatio.toFixed(2)} → ${after.mudRatio.toFixed(2)}`
  );
  onProgress?.(100, 'Producer Pass complete');
  return {
    buffer: current,
    notes,
    listens: 2,
    cohesionScore: after.clarity,
    character: analysis.character,
  };
}
