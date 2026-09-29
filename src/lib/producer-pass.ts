/**
 * Producer Pass — clarity-first intangibles polish.
 *
 * Multiple listens, but every move is gated: if a take gets muddier or
 * quieter, it is discarded. No bass/warmth boosts. Ends with the shared
 * Clarity Lock so muddy output cannot leave this stage.
 */

import { detectSonicCharacter, SonicCharacter } from '@/lib/sonic-character';
import { SongSection } from '@/types/audio';
import {
  applyClarityLock,
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

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
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

function calcPeaking(freq: number, gain: number, Q: number, sr: number): BiquadCoeffs {
  const A = Math.pow(10, gain / 40);
  const w0 = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w0) / (2 * Q);
  const b0 = 1 + alpha * A;
  const b1 = -2 * Math.cos(w0);
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha / A;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function processBiquad(data: Float32Array, c: BiquadCoeffs): Float32Array {
  const out = new Float32Array(data.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

function createBuffer(L: Float32Array, R: Float32Array, sr: number, stereo: boolean): AudioBuffer {
  const ctx = new OfflineAudioContext(stereo ? 2 : 1, L.length, sr);
  const buf = ctx.createBuffer(stereo ? 2 : 1, L.length, sr);
  buf.copyToChannel(new Float32Array(L), 0);
  if (stereo) buf.copyToChannel(new Float32Array(R), 1);
  return buf;
}

/** Tiny parallel glue — dry stays dominant; wet gain-matched. */
function lightParallelGlue(
  L: Float32Array,
  R: Float32Array,
  sr: number,
  wet: number
): { L: Float32Array; R: Float32Array } {
  if (wet < 0.03) return { L, R };
  wet = Math.min(0.1, wet);
  const compL = new Float32Array(L.length);
  const compR = new Float32Array(R.length);
  const thresh = 0.35;
  const ratio = 1.5;
  const att = 1 - Math.exp(-1 / (sr * 0.025));
  const rel = 1 - Math.exp(-1 / (sr * 0.25));
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

/** Kick mask: duck only 220–400 Hz when the low end speaks. No side collapse. */
function kickPocket(
  L: Float32Array,
  R: Float32Array,
  sr: number,
  amount: number
): { L: Float32Array; R: Float32Array } {
  if (amount < 0.05) return { L, R };
  const outL = new Float32Array(L.length);
  const outR = new Float32Array(R.length);
  const aKick = Math.exp((-2 * Math.PI * 90) / sr);
  const aLo = Math.exp((-2 * Math.PI * 220) / sr);
  const aHi = Math.exp((-2 * Math.PI * 400) / sr);
  const att = 1 - Math.exp(-1 / (sr * 0.004));
  const rel = 1 - Math.exp(-1 / (sr * 0.08));
  let kickLp = 0;
  let env = 0;
  let loL = 0,
    hiL = 0,
    loR = 0,
    hiR = 0;
  const maxDuck = 0.12 * amount;

  for (let i = 0; i < L.length; i++) {
    const mid = (L[i] + R[i]) * 0.5;
    kickLp = mid + (kickLp - mid) * aKick;
    const kickAbs = Math.abs(kickLp);
    env += (kickAbs > env ? att : rel) * (kickAbs - env);
    const duck = Math.min(maxDuck, env * amount * 1.4);

    loL = L[i] + (loL - L[i]) * aLo;
    hiL = L[i] + (hiL - L[i]) * aHi;
    loR = R[i] + (loR - R[i]) * aLo;
    hiR = R[i] + (hiR - R[i]) * aHi;
    outL[i] = L[i] - (hiL - loL) * duck;
    outR[i] = R[i] - (hiR - loR) * duck;
  }
  return { L: outL, R: outR };
}

/** Unity-mean arrangement contrast — never turns the song down overall. */
function arrangementBreathe(
  L: Float32Array,
  R: Float32Array,
  sr: number,
  sections: SongSection[],
  intensity: number
): { L: Float32Array; R: Float32Array; note: string } {
  const curve = new Float32Array(L.length);
  curve.fill(1);
  if (sections.length >= 2) {
    for (const s of sections) {
      const start = Math.max(0, Math.floor(s.start * sr));
      const end = Math.min(L.length, Math.floor(s.end * sr));
      let g = 1;
      if (s.kind === 'chorus') g = 1 + 0.014 * intensity;
      else if (s.kind === 'verse' || s.kind === 'bridge' || s.kind === 'outro') g = 1 - 0.008 * intensity;
      else if (s.kind === 'intro') g = 1 - 0.006 * intensity;
      for (let i = start; i < end; i++) curve[i] = g;
    }
  } else {
    for (let i = 0; i < L.length; i++) {
      curve[i] = 1 + (Math.sin(Math.PI * (i / L.length)) - 0.5) * 0.008 * intensity;
    }
  }
  const smoothN = Math.max(1, Math.floor(sr * 0.08));
  for (let i = 1; i < L.length; i++) {
    curve[i] = curve[i - 1] + (1 / smoothN) * (curve[i] - curve[i - 1]);
  }
  let sum = 0;
  for (let i = 0; i < L.length; i++) sum += curve[i];
  const mean = sum / L.length || 1;
  const outL = new Float32Array(L.length);
  const outR = new Float32Array(R.length);
  for (let i = 0; i < L.length; i++) {
    const g = curve[i] / mean;
    outL[i] = L[i] * g;
    outR[i] = R[i] * g;
  }
  return {
    L: outL,
    R: outR,
    note: sections.length
      ? `Arrangement contrast across ${sections.length} sections (unity-mean)`
      : 'Gentle arc (unity-mean)',
  };
}

export async function applyProducerPass(
  buffer: AudioBuffer,
  sections: SongSection[] = [],
  options: ProducerPassOptions = {}
): Promise<ProducerPassResult> {
  const { onProgress, signal } = options;
  const notes: string[] = [];
  const sr = buffer.sampleRate;
  const stereo = buffer.numberOfChannels >= 2;

  throwIfAborted(signal);
  onProgress?.(4, 'Producer Pass: first listen — clarity baseline...');
  await yieldToUI();

  const analysis = detectSonicCharacter(buffer);
  const soft =
    analysis.character === 'minimal' ||
    analysis.character === 'moody' ||
    analysis.character === 'atmospheric' ||
    analysis.character === 'soulful';

  let intensity =
    typeof options.intensity === 'number'
      ? Math.max(0.2, Math.min(0.55, options.intensity))
      : 0.32 + analysis.traits.energy * 0.1;
  if (soft) intensity *= 0.85;
  intensity = Math.max(0.25, Math.min(0.48, intensity));

  notes.push(
    `Producer Pass · ${analysis.character} · intensity ${Math.round(intensity * 100)}%`
  );
  notes.push('Clarity-gated listens — no bass boost, no loudness drop, mud takes rejected.');

  let current = buffer;
  let baseline = measureClarity(current);
  notes.push(
    `Listen 1 · clarity ${baseline.clarity.toFixed(2)} · mud ${baseline.mudRatio.toFixed(2)}`
  );
  let listensDone = 1;

  // ── Listen 2: kick pocket only (subtractive) ─────────────────
  throwIfAborted(signal);
  onProgress?.(28, 'Producer Pass: listen 2 — kick pocket...');
  await yieldToUI();
  {
    let L = new Float32Array(current.getChannelData(0));
    let R = new Float32Array(stereo ? current.getChannelData(1) : current.getChannelData(0));
    const target = signalRms(L, R);
    const pocketed = kickPocket(L, R, sr, intensity * 0.65);
    L = new Float32Array(pocketed.L);
    R = new Float32Array(pocketed.R);
    matchRmsLevel(L, R, target);
    const candidate = createBuffer(L, R, sr, stereo);
    const gate = preferClearer(candidate, current);
    current = gate.buffer;
    notes.push(`Listen 2: kick pocket · ${gate.reason}`);
    listensDone = 2;
  }

  // ── Listen 3: very light parallel glue (gated) ───────────────
  throwIfAborted(signal);
  onProgress?.(50, 'Producer Pass: listen 3 — light glue...');
  await yieldToUI();
  {
    let L = new Float32Array(current.getChannelData(0));
    let R = new Float32Array(stereo ? current.getChannelData(1) : current.getChannelData(0));
    const target = signalRms(L, R);
    const glued = lightParallelGlue(L, R, sr, soft ? 0.04 : 0.07);
    L = new Float32Array(glued.L);
    R = new Float32Array(glued.R);
    matchRmsLevel(L, R, target);
    const candidate = createBuffer(L, R, sr, stereo);
    const gate = preferClearer(candidate, current);
    current = gate.buffer;
    notes.push(`Listen 3: parallel glue · ${gate.reason}`);
    listensDone = 3;
  }

  // ── Listen 4: arrangement breathe (unity-mean, gated) ────────
  throwIfAborted(signal);
  onProgress?.(68, 'Producer Pass: listen 4 — arrangement contrast...');
  await yieldToUI();
  {
    let L = new Float32Array(current.getChannelData(0));
    let R = new Float32Array(stereo ? current.getChannelData(1) : current.getChannelData(0));
    const arr = arrangementBreathe(L, R, sr, sections, intensity);
    const candidate = createBuffer(new Float32Array(arr.L), new Float32Array(arr.R), sr, stereo);
    const gate = preferClearer(candidate, current);
    current = gate.buffer;
    notes.push(`Listen 4: ${arr.note} · ${gate.reason}`);
    listensDone = 4;
  }

  // ── Always finish with Clarity Lock (permanent) ──────────────
  throwIfAborted(signal);
  onProgress?.(82, 'Producer Pass: clarity lock...');
  await yieldToUI();
  const locked = await applyClarityLock(current, (p, m) =>
    onProgress?.(82 + Math.round(p * 0.16), m)
  );
  // Prefer locked only if clearer; otherwise keep current
  const finalGate = preferClearer(locked.buffer, current);
  current = finalGate.buffer;
  notes.push(...locked.notes.map((n) => `Clarity lock: ${n}`));
  notes.push(`Final gate: ${finalGate.reason}`);

  const after = measureClarity(current);
  notes.push(
    `Done · clarity ${baseline.clarity.toFixed(2)} → ${after.clarity.toFixed(2)} · mud ${baseline.mudRatio.toFixed(2)} → ${after.mudRatio.toFixed(2)}`
  );

  onProgress?.(100, 'Producer Pass complete');
  return {
    buffer: current,
    notes,
    listens: listensDone,
    cohesionScore: after.clarity,
    character: analysis.character,
  };
}
