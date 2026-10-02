/**
 * Vocal clarity / pocket for full stereo mixes.
 *
 * Center (mid) gets studio vocal treatment; sides stay untouched so the
 * instrumental width and tone remain coherent with the lead.
 *
 * Mid-only moves:
 *  - gentle phrase ride
 *  - presence + intelligibility EQ
 *  - soft de-ess
 *  - light vocal-band compression
 * Optional micro side dip at ~3 kHz so the lead can sit forward without
 * carving body from the beat.
 */

export interface VocalPocketResult {
  buffer: AudioBuffer;
  notes: string[];
  vocalPresence: number;
}

async function yieldToUI() {
  await new Promise<void>((r) => setTimeout(r, 0));
}

function createMonoBuffer(data: Float32Array, sampleRate: number): AudioBuffer {
  const ctx = new OfflineAudioContext(1, data.length, sampleRate);
  const buf = ctx.createBuffer(1, data.length, sampleRate);
  buf.copyToChannel(new Float32Array(data), 0);
  return buf;
}

function createStereoBuffer(L: Float32Array, R: Float32Array, sampleRate: number): AudioBuffer {
  const ctx = new OfflineAudioContext(2, L.length, sampleRate);
  const buf = ctx.createBuffer(2, L.length, sampleRate);
  buf.copyToChannel(new Float32Array(L), 0);
  buf.copyToChannel(new Float32Array(R), 1);
  return buf;
}

/** Estimate how “vocal-like” the mid channel is (presence band energy ratio). */
function estimateVocalPresence(buffer: AudioBuffer): number {
  const sr = buffer.sampleRate;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const len = Math.min(L.length, Math.floor(sr * 45));

  let midPres = 0;
  let midFull = 0;
  let sidePres = 0;
  const a = Math.exp((-2 * Math.PI * 2800) / sr);
  const b = Math.exp((-2 * Math.PI * 4500) / sr);
  let lpA = 0;
  let lpB = 0;
  let lpSideA = 0;
  let lpSideB = 0;

  for (let i = 0; i < len; i++) {
    const mid = (L[i] + R[i]) * 0.5;
    const side = (L[i] - R[i]) * 0.5;
    lpA = mid + (lpA - mid) * a;
    lpB = mid + (lpB - mid) * b;
    const band = lpA - lpB;
    midPres += band * band;
    midFull += mid * mid;

    lpSideA = side + (lpSideA - side) * a;
    lpSideB = side + (lpSideB - side) * b;
    const sBand = lpSideA - lpSideB;
    sidePres += sBand * sBand;
  }

  const midRatio = midFull > 1e-12 ? midPres / midFull : 0;
  const sideRatio = midPres > 1e-12 ? midPres / (midPres + sidePres + 1e-12) : 0.5;
  return Math.max(0, Math.min(1, midRatio * 4.5 * (0.45 + sideRatio * 0.55)));
}

/** Phrase-level RMS ride — keeps lead consistent without crushing. */
function rideChannel(data: Float32Array, sampleRate: number, amount: number): Float32Array {
  if (amount < 0.05) return data;
  const output = new Float32Array(data.length);
  const blockSize = Math.floor(sampleRate * 0.1);
  const targetRms = 0.085;
  const maxBoost = 1 + amount * 0.7; // ~+3.5 dB max
  const maxCut = 1 - amount * 0.22;
  const noiseFloor = 0.008;
  const numBlocks = Math.ceil(data.length / blockSize);
  const blockGains = new Float32Array(numBlocks);

  for (let b = 0; b < numBlocks; b++) {
    const start = b * blockSize;
    const end = Math.min(start + blockSize, data.length);
    let rms = 0;
    for (let i = start; i < end; i++) rms += data[i] * data[i];
    rms = Math.sqrt(rms / Math.max(1, end - start));
    if (rms < noiseFloor) blockGains[b] = 1;
    else blockGains[b] = Math.max(maxCut, Math.min(maxBoost, targetRms / rms));
  }

  const smoothCoeff = 1 - Math.exp(-1 / (sampleRate * 0.08));
  let g = 1;
  for (let i = 0; i < data.length; i++) {
    const bi = Math.min(Math.floor(i / blockSize), numBlocks - 1);
    g += smoothCoeff * (blockGains[bi] - g);
    output[i] = data[i] * g;
  }
  return output;
}

/** Soft vocal-band compressor on mono mid (attack lets consonants through). */
function softVocalComp(data: Float32Array, sampleRate: number, amount: number): Float32Array {
  if (amount < 0.08) return data;
  const out = new Float32Array(data.length);
  const thr = 0.12;
  const ratio = 1.6 + amount * 1.2; // ~1.6–2.8
  const att = 1 - Math.exp(-1 / (sampleRate * 0.008));
  const rel = 1 - Math.exp(-1 / (sampleRate * 0.12));
  let env = 0;
  const makeup = 1 + amount * 0.08;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    env += (abs > env ? att : rel) * (abs - env);
    let g = 1;
    if (env > thr) {
      g = Math.pow(env / thr, 1 / ratio - 1);
      g = 1 + (g - 1) * Math.min(1, amount);
    }
    out[i] = data[i] * g * makeup;
  }
  return out;
}

/**
 * Dynamic de-ess: when 6–9 kHz energy spikes, duck that band on the mid.
 * Static shelves can dull the whole vocal; this only tames esses.
 */
function dynamicDeEss(data: Float32Array, sampleRate: number, amount: number): Float32Array {
  if (amount < 0.08) return data;
  const out = new Float32Array(data.length);
  const aLo = Math.exp((-2 * Math.PI * 5500) / sampleRate);
  const aHi = Math.exp((-2 * Math.PI * 9500) / sampleRate);
  const att = 1 - Math.exp(-1 / (sampleRate * 0.002));
  const rel = 1 - Math.exp(-1 / (sampleRate * 0.05));
  let lpLo = 0;
  let lpHi = 0;
  let env = 0;
  const thr = 0.045;
  const maxDuck = 0.35 * amount; // fraction of sibilant band removed

  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    lpLo = x + (lpLo - x) * aLo;
    lpHi = x + (lpHi - x) * aHi;
    const sib = lpLo - lpHi;
    const sibAbs = Math.abs(sib);
    env += (sibAbs > env ? att : rel) * (sibAbs - env);
    let duck = 0;
    if (env > thr) {
      duck = Math.min(maxDuck, ((env - thr) / (thr + 1e-6)) * maxDuck);
    }
    out[i] = x - sib * duck;
  }
  return out;
}

async function peakingFilter(
  buffer: AudioBuffer,
  freq: number,
  gain: number,
  Q: number
): Promise<AudioBuffer> {
  if (Math.abs(gain) < 0.08) return buffer;
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const f = ctx.createBiquadFilter();
  f.type = 'peaking';
  f.frequency.value = freq;
  f.Q.value = Q;
  f.gain.value = gain;
  src.connect(f);
  f.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

async function highShelfFilter(
  buffer: AudioBuffer,
  freq: number,
  gain: number
): Promise<AudioBuffer> {
  if (Math.abs(gain) < 0.08) return buffer;
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const f = ctx.createBiquadFilter();
  f.type = 'highshelf';
  f.frequency.value = freq;
  f.Q.value = 0.7;
  f.gain.value = gain;
  src.connect(f);
  f.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

function matchMonoRms(data: Float32Array, target: number, forward = 1.09): Float32Array {
  let e = 0;
  for (let i = 0; i < data.length; i++) e += data[i] * data[i];
  const cur = Math.sqrt(e / Math.max(1, data.length));
  if (cur < 1e-8 || target < 1e-8) return data;
  // Keep mid level coherent with the mix, with a small lead sit-forward
  const g = Math.max(0.88, Math.min(1.18, (target * forward) / cur));
  if (Math.abs(g - 1) < 0.01) return data;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] * g;
  return out;
}

/**
 * Sit vocals clearly in a stereo mix: treat the center, leave the sides.
 */
export async function applyVocalPocket(
  buffer: AudioBuffer,
  onProgress?: (p: number, m: string) => void
): Promise<VocalPocketResult> {
  const notes: string[] = [];
  onProgress?.(5, 'Detecting vocal presence...');
  await yieldToUI();

  const vocalPresence = estimateVocalPresence(buffer);
  notes.push(`Vocal presence score ${(vocalPresence * 100).toFixed(0)}%`);

  if (vocalPresence < 0.15) {
    onProgress?.(100, 'Vocal clarity skipped (instrumental / low vocal cue)');
    notes.push('Low mid-presence cue — vocal clarity skipped (keeps instrumental intact).');
    return { buffer, notes, vocalPresence };
  }

  // Adaptive intensity from how vocal-forward the mid is
  const amount = Math.min(0.85, 0.42 + vocalPresence * 0.48);
  const forward = 1.06 + amount * 0.05; // ~+0.5…+0.9 dB lead sit
  const sr = buffer.sampleRate;

  onProgress?.(20, 'Center ride — evening the lead...');
  await yieldToUI();

  if (buffer.numberOfChannels < 2) {
    let mid = new Float32Array(buffer.getChannelData(0));
    const target = (() => {
      let e = 0;
      for (let i = 0; i < mid.length; i++) e += mid[i] * mid[i];
      return Math.sqrt(e / mid.length);
    })();
    mid = new Float32Array(rideChannel(mid, sr, amount * 0.65));
    mid = new Float32Array(softVocalComp(mid, sr, amount * 0.55));
    mid = new Float32Array(dynamicDeEss(mid, sr, amount * 0.7));
    let mono = createMonoBuffer(mid, sr);
    mono = await peakingFilter(mono, 1800, Math.min(0.7, 0.55 * amount), 1.0);
    mono = await peakingFilter(mono, 2800, Math.min(1.8, 1.55 * amount), 1.15);
    mono = await peakingFilter(mono, 5200, Math.min(1.05, 0.9 * amount), 1.3);
    mono = await highShelfFilter(mono, 11000, Math.min(0.85, 0.65 * amount));
    mid = new Float32Array(matchMonoRms(new Float32Array(mono.getChannelData(0)), target, forward));
    notes.push(
      `Mono vocal clarity ×${amount.toFixed(2)} · presence/air + de-ess`,
      'Instrumental path unchanged (mono source)'
    );
    onProgress?.(100, 'Vocal clarity done');
    return { buffer: createMonoBuffer(mid, sr), notes, vocalPresence };
  }

  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);
  const len = buffer.length;
  const mid = new Float32Array(len);
  const side = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    mid[i] = (L[i] + R[i]) * 0.5;
    side[i] = (L[i] - R[i]) * 0.5;
  }

  let targetMid = 0;
  for (let i = 0; i < len; i++) targetMid += mid[i] * mid[i];
  targetMid = Math.sqrt(targetMid / len);

  let processed = new Float32Array(rideChannel(mid, sr, amount * 0.6));
  notes.push(`Center vocal ride ×${(amount * 0.6).toFixed(2)}`);

  onProgress?.(40, 'Vocal compression + de-ess (center only)...');
  await yieldToUI();
  processed = new Float32Array(softVocalComp(processed, sr, amount * 0.5));
  processed = new Float32Array(dynamicDeEss(processed, sr, amount * 0.75));
  notes.push('Soft vocal comp + dynamic de-ess on mid');

  onProgress?.(60, 'Opening vocal presence (center only)...');
  await yieldToUI();
  let midBuf = createMonoBuffer(processed, sr);
  // Intelligibility / presence / air — mid only so wide instruments keep tone
  const speechDb = Math.min(0.75, 0.55 * amount);
  const presDb = Math.min(1.9, 1.5 * amount);
  const intelDb = Math.min(1.15, 0.95 * amount);
  const airDb = Math.min(0.9, 0.7 * amount);
  midBuf = await peakingFilter(midBuf, 1800, speechDb, 1.0);
  midBuf = await peakingFilter(midBuf, 2750, presDb, 1.1);
  midBuf = await peakingFilter(midBuf, 5100, intelDb, 1.25);
  midBuf = await highShelfFilter(midBuf, 11500, airDb);
  notes.push(
    `Mid speech +${speechDb.toFixed(1)} @1.8k · presence +${presDb.toFixed(1)} @2.75k · intel +${intelDb.toFixed(1)} @5.1k · air +${airDb.toFixed(1)}`
  );

  processed = new Float32Array(matchMonoRms(new Float32Array(midBuf.getChannelData(0)), targetMid, forward));

  // Micro side pocket — only the vocal presence band, shallow, so lead sits
  // forward without thinning guitars/hats across the spectrum
  onProgress?.(78, 'Micro side pocket for lead forwardness...');
  await yieldToUI();
  let sideOut = side;
  const sideDip = Math.min(0.75, 0.4 + amount * 0.4);
  if (vocalPresence > 0.25 && sideDip > 0.2) {
    const sideBuf = createMonoBuffer(side, sr);
    const carved = await peakingFilter(sideBuf, 3100, -sideDip, 1.6);
    sideOut = new Float32Array(carved.getChannelData(0));
    notes.push(`Side pocket −${sideDip.toFixed(1)} dB @3.1 kHz (narrow — instruments kept)`);
  } else {
    notes.push('Side pocket skipped — sides fully preserved');
  }

  onProgress?.(90, 'Rebuilding coherent stereo...');
  await yieldToUI();
  const outL = new Float32Array(len);
  const outR = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    outL[i] = processed[i] + sideOut[i];
    outR[i] = processed[i] - sideOut[i];
  }

  // Soft peak safety — never a blanket level cut
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
  if (peak > 0.98) {
    const g = 0.98 / peak;
    for (let i = 0; i < len; i++) {
      outL[i] *= g;
      outR[i] *= g;
    }
  }

  notes.push('Sides/instrumental tone preserved · lead clarified on center');
  onProgress?.(100, 'Vocal clarity done');
  return { buffer: createStereoBuffer(outL, outR, sr), notes, vocalPresence };
}
