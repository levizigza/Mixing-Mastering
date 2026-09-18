/**
 * Vocal pocket processing for full stereo mixes.
 *
 * Cryo-style public concept: make vocals sit naturally — ride the center
 * (where leads live) and gently carve competing mid energy so the voice
 * has a pocket without a separate vocal stem.
 */

export interface VocalPocketResult {
  buffer: AudioBuffer;
  notes: string[];
  vocalPresence: number;
}

async function yieldToUI() {
  await new Promise<void>((r) => setTimeout(r, 0));
}

/** Estimate how “vocal-like” the mid channel is (presence band energy ratio). */
function estimateVocalPresence(buffer: AudioBuffer): number {
  const sr = buffer.sampleRate;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const len = Math.min(L.length, Math.floor(sr * 45)); // first 45s

  // One-pole band energy proxies
  let midPres = 0;
  let midFull = 0;
  let sidePres = 0;
  // ~2.8 kHz presence emphasis via simple diff of LP stages
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
  // High when presence is mid-dominant (typical lead vocal)
  return Math.max(0, Math.min(1, midRatio * 4.5 * (0.45 + sideRatio * 0.55)));
}

/** Gentle RMS rider on a mono channel (phrase-level consistency). */
function rideChannel(data: Float32Array, sampleRate: number, amount: number): Float32Array {
  if (amount < 0.05) return data;
  const output = new Float32Array(data.length);
  const blockSize = Math.floor(sampleRate * 0.08);
  const targetRms = 0.09;
  const maxBoost = 1 + amount * 0.9; // up to ~+5 dB at full
  const maxCut = 1 - amount * 0.35;
  const noiseFloor = 0.007;
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

  const smoothCoeff = 1 - Math.exp(-1 / (sampleRate * 0.06));
  let g = 1;
  for (let i = 0; i < data.length; i++) {
    const bi = Math.min(Math.floor(i / blockSize), numBlocks - 1);
    g += smoothCoeff * (blockGains[bi] - g);
    output[i] = data[i] * g;
  }
  return output;
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

/**
 * Sit vocals (center) more naturally in a stereo mix:
 * ride mid levels + mild presence carve so the lead has a pocket.
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

  if (vocalPresence < 0.18) {
    onProgress?.(100, 'Pocket skipped (instrumental / low vocal cue)');
    notes.push('Low mid-presence cue — vocal pocket light pass skipped (keeps instruments intact).');
    return { buffer, notes, vocalPresence };
  }

  const amount = 0.35 + vocalPresence * 0.55; // 0.35–0.9
  onProgress?.(25, 'Riding center channel...');
  await yieldToUI();

  if (buffer.numberOfChannels < 2) {
    const ridden = rideChannel(new Float32Array(buffer.getChannelData(0)), buffer.sampleRate, amount);
    const ctx = new OfflineAudioContext(1, ridden.length, buffer.sampleRate);
    const out = ctx.createBuffer(1, ridden.length, buffer.sampleRate);
    out.copyToChannel(new Float32Array(ridden), 0);
    // Mild presence lift on mono
    const lifted = await peakingFilter(out, 3200, 0.8 * amount, 1.1);
    notes.push(`Mono vocal ride ×${amount.toFixed(2)} + presence +${(0.8 * amount).toFixed(1)} dB`);
    onProgress?.(100, 'Vocal pocket done');
    return { buffer: lifted, notes, vocalPresence };
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

  const riddenMid = rideChannel(mid, buffer.sampleRate, amount * 0.85);
  notes.push(`Center vocal ride ×${(amount * 0.85).toFixed(2)}`);

  // Mild side carve around vocal presence so leads poke through
  onProgress?.(55, 'Carving pocket around vocals...');
  await yieldToUI();
  const ctxM = new OfflineAudioContext(1, len, buffer.sampleRate);
  const midBuf = ctxM.createBuffer(1, len, buffer.sampleRate);
  midBuf.copyToChannel(new Float32Array(riddenMid), 0);
  // Dip competing mud in mid a touch, lift presence
  let processedMid = await peakingFilter(midBuf, 280, -1.1 * amount, 1.3);
  processedMid = await peakingFilter(processedMid, 3200, 1.0 * amount, 1.15);

  const sideCtx = new OfflineAudioContext(1, len, buffer.sampleRate);
  const sideBuf = sideCtx.createBuffer(1, len, buffer.sampleRate);
  sideBuf.copyToChannel(new Float32Array(side), 0);
  // Soften side energy in vocal presence band (reduces masking from wide pads/hats)
  const carvedSide = await peakingFilter(sideBuf, 3000, -1.4 * amount, 1.4);

  onProgress?.(85, 'Rebuilding stereo...');
  await yieldToUI();
  const m = processedMid.getChannelData(0);
  const s = carvedSide.getChannelData(0);
  const outL = new Float32Array(len);
  const outR = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    outL[i] = m[i] + s[i];
    outR[i] = m[i] - s[i];
  }
  const outCtx = new OfflineAudioContext(2, len, buffer.sampleRate);
  const out = outCtx.createBuffer(2, len, buffer.sampleRate);
  out.copyToChannel(new Float32Array(outL), 0);
  out.copyToChannel(new Float32Array(outR), 1);

  notes.push(
    `Presence +${(1.0 * amount).toFixed(1)} dB @ 3.2 kHz · mud −${(1.1 * amount).toFixed(1)} dB`,
    `Side carve −${(1.4 * amount).toFixed(1)} dB @ 3 kHz for vocal pocket`
  );
  onProgress?.(100, 'Vocal pocket done');
  return { buffer: out, notes, vocalPresence };
}
