/**
 * Surgical resonance cleanup (client-side).
 *
 * Learns from pro AI mixers' public description of "micro EQ" / resonance
 * hunting — not proprietary code. Finds persistent spectral peaks that stick
 * out above a smoothed envelope and applies narrow peaking cuts.
 */

export interface ResonanceNotch {
  frequency: number;
  gainDb: number;
  Q: number;
}

export interface ResonanceCleanupResult {
  buffer: AudioBuffer;
  notes: string[];
  notches: ResonanceNotch[];
}

async function yieldToUI() {
  await new Promise<void>((r) => setTimeout(r, 0));
}

/** Simple radix-2 FFT (re/im in-place). */
function fft(re: Float32Array, im: Float32Array, inverse: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * wRe - im[i + j + len / 2] * wIm;
        const vIm = re[i + j + len / 2] * wIm + im[i + j + len / 2] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nWRe;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

function smoothSpectrum(mag: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(mag.length);
  for (let i = 0; i < mag.length; i++) {
    let sum = 0;
    let n = 0;
    const a = Math.max(0, i - radius);
    const b = Math.min(mag.length - 1, i + radius);
    for (let j = a; j <= b; j++) {
      sum += mag[j];
      n++;
    }
    out[i] = sum / (n || 1);
  }
  return out;
}

/**
 * Average mono magnitude spectrum over the program (hopped FFT).
 * Yields periodically so long tracks stay responsive.
 */
async function averageMagnitudeSpectrum(
  buffer: AudioBuffer,
  onProgress?: (p: number, m: string) => void
): Promise<{ mag: Float32Array; sr: number; fftSize: number }> {
  const sr = buffer.sampleRate;
  const fftSize = 2048;
  const hop = 1024;
  const bins = fftSize / 2;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const window = hann(fftSize);
  const accum = new Float32Array(bins);
  let frames = 0;
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const yieldEvery = Math.max(1, Math.floor((sr * 0.4) / hop));

  for (let start = 0; start + fftSize <= L.length; start += hop) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < fftSize; i++) {
      const m = (L[start + i] + R[start + i]) * 0.5;
      re[i] = m * window[i];
    }
    fft(re, im, false);
    for (let k = 0; k < bins; k++) {
      accum[k] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
    frames++;
    if (frames % yieldEvery === 0) {
      onProgress?.(10 + Math.min(50, Math.round((start / L.length) * 50)), 'Scanning resonances...');
      await yieldToUI();
    }
  }
  if (frames > 0) {
    for (let k = 0; k < bins; k++) accum[k] /= frames;
  }
  return { mag: accum, sr, fftSize };
}

/** Find persistent peaks above a smoothed envelope in the musical band. */
function findResonancePeaks(
  mag: Float32Array,
  sr: number,
  fftSize: number,
  maxNotches = 6
): ResonanceNotch[] {
  const bins = mag.length;
  const envelope = smoothSpectrum(mag, 8);
  const candidates: { bin: number; excess: number; freq: number }[] = [];

  const minHz = 180;
  const maxHz = 8500;
  const minBin = Math.max(2, Math.floor((minHz * fftSize) / sr));
  const maxBin = Math.min(bins - 2, Math.floor((maxHz * fftSize) / sr));

  for (let k = minBin; k <= maxBin; k++) {
    const env = Math.max(envelope[k], 1e-12);
    const excess = mag[k] / env;
    // Local peak + meaningfully above envelope
    if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1] && excess > 1.55) {
      const freq = (k * sr) / fftSize;
      candidates.push({ bin: k, excess, freq });
    }
  }

  candidates.sort((a, b) => b.excess - a.excess);

  const notches: ResonanceNotch[] = [];
  const minSepHz = 180;
  for (const c of candidates) {
    if (notches.length >= maxNotches) break;
    if (notches.some((n) => Math.abs(n.frequency - c.freq) < minSepHz)) continue;
    // Map excess → cut depth (surgical, not destructive)
    const cut = Math.min(5.5, Math.max(1.2, (c.excess - 1.4) * 3.2));
    const Q = c.freq < 500 ? 4.5 : c.freq < 2000 ? 6 : 8;
    notches.push({ frequency: Math.round(c.freq), gainDb: -cut, Q });
  }

  notches.sort((a, b) => a.frequency - b.frequency);
  return notches;
}

async function applyNotchesOffline(
  buffer: AudioBuffer,
  notches: ResonanceNotch[],
  onProgress?: (p: number, m: string) => void
): Promise<AudioBuffer> {
  if (notches.length === 0) return buffer;
  onProgress?.(70, `Applying ${notches.length} surgical notches...`);
  await yieldToUI();

  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  let node: AudioNode = src;
  for (const n of notches) {
    const f = ctx.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = n.frequency;
    f.Q.value = n.Q;
    f.gain.value = n.gainDb;
    node.connect(f);
    node = f;
  }
  node.connect(ctx.destination);
  src.start(0);
  onProgress?.(90, 'Rendering resonance cleanup...');
  return ctx.startRendering();
}

/**
 * Detect and notch persistent room / harsh resonances on a stereo (or mono) mix.
 */
export async function applyResonanceCleanup(
  buffer: AudioBuffer,
  onProgress?: (p: number, m: string) => void
): Promise<ResonanceCleanupResult> {
  onProgress?.(4, 'Resonance scan...');
  await yieldToUI();

  const { mag, sr, fftSize } = await averageMagnitudeSpectrum(buffer, onProgress);
  onProgress?.(62, 'Picking problem peaks...');
  await yieldToUI();

  const notches = findResonancePeaks(mag, sr, fftSize, 6);
  if (notches.length === 0) {
    onProgress?.(100, 'No strong resonances found');
    return {
      buffer,
      notes: ['Resonance scan clean — no surgical notches needed.'],
      notches: [],
    };
  }

  const out = await applyNotchesOffline(buffer, notches, onProgress);
  const notes = [
    `Surgical resonance EQ: ${notches.length} notch${notches.length === 1 ? '' : 'es'}.`,
    ...notches.map(
      (n) => `Notch ${n.frequency} Hz · ${n.gainDb.toFixed(1)} dB · Q ${n.Q.toFixed(1)}`
    ),
  ];
  onProgress?.(100, 'Resonance cleanup done');
  return { buffer: out, notes, notches };
}
