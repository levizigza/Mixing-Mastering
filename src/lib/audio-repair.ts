// ─── Audio Repair Station ────────────────────────────────────────
// Light forensic cleanup: DC, declip, denoise, declick, dehum, deplosive.

export interface RepairSettings {
  denoise: number; // 0–100
  declick: number;
  dehum: number; // 0=off, 50=50Hz, 60=60Hz preferred via humFreq
  humFreq: 50 | 60;
  deplosive: number;
  declip: number;
  dereverb: number;
}

export const defaultRepairSettings: RepairSettings = {
  denoise: 45,
  declick: 40,
  dehum: 35,
  humFreq: 60,
  deplosive: 50,
  declip: 40,
  dereverb: 20,
};

export interface RepairResult {
  buffer: AudioBuffer;
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

function removeDC(data: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const dc = sum / data.length;
  if (Math.abs(dc) < 1e-6) return data;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] - dc;
  return out;
}

function softDeclip(data: Float32Array, amount: number): Float32Array {
  if (amount < 0.05) return data;
  const out = new Float32Array(data.length);
  const thr = 0.92 - amount * 0.15;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const a = Math.abs(x);
    if (a < thr) out[i] = x;
    else {
      const t = (a - thr) / (1 - thr + 1e-6);
      const soft = thr + (1 - thr) * Math.tanh(t * (1 + amount * 2));
      out[i] = Math.sign(x) * soft;
    }
  }
  return out;
}

function noiseGate(data: Float32Array, sr: number, amount: number): Float32Array {
  if (amount < 0.05) return data;
  const thrDb = -48 + amount * 12;
  const thr = Math.pow(10, thrDb / 20);
  const out = new Float32Array(data.length);
  const attack = 1 - Math.exp(-1 / (sr * 0.005));
  const release = 1 - Math.exp(-1 / (sr * 0.12));
  let env = 0;
  let gain = 1;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    env += (abs > env ? attack : release) * (abs - env);
    const target = env > thr ? 1 : 0.05 + (1 - amount) * 0.2;
    gain += (target > gain ? attack : release) * (target - gain);
    out[i] = data[i] * gain;
  }
  return out;
}

/** Hann window helper */
function makeHann(frameSize: number): Float32Array {
  const window = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)));
  }
  return window;
}

/** In-place radix-2 Cooley–Tukey FFT (length must be power of 2). */
function fftRadix2(re: Float32Array, im: Float32Array, inverse: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
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
        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
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

/**
 * Magnitude spectral subtract denoise on overlapping frames.
 * FFT keeps full-spectrum quality without the naive-DFT freeze; yields keep the UI alive.
 * Quality first: never skip this stage on long tracks.
 */
async function spectralDenoise(
  data: Float32Array,
  sr: number,
  amount: number,
  noiseMag?: Float32Array
): Promise<{ out: Float32Array; noiseMag: Float32Array }> {
  if (amount < 0.05) return { out: data, noiseMag: noiseMag ?? new Float32Array(0) };

  const frameSize = 1024;
  const hop = 256;
  const bins = frameSize / 2;
  const out = new Float32Array(data.length);
  const window = makeHann(frameSize);
  const winSum = new Float32Array(data.length);
  const strength = amount * 0.85;
  const re = new Float32Array(frameSize);
  const im = new Float32Array(frameSize);

  let profile = noiseMag;
  if (!profile || profile.length !== bins) {
    profile = new Float32Array(bins);
    const profileLen = Math.min(data.length, Math.floor(sr * 2));
    const energies: { start: number; e: number }[] = [];
    for (let start = 0; start + frameSize < profileLen; start += hop) {
      let e = 0;
      for (let i = 0; i < frameSize; i++) e += data[start + i] * data[start + i];
      energies.push({ start, e });
    }
    energies.sort((a, b) => a.e - b.e);
    const take = Math.max(1, Math.floor(energies.length * 0.15));
    let noiseFrames = 0;
    for (let n = 0; n < take; n++) {
      const start = energies[n].start;
      re.fill(0);
      im.fill(0);
      for (let i = 0; i < frameSize; i++) re[i] = data[start + i] * window[i];
      fftRadix2(re, im, false);
      for (let k = 0; k < bins; k++) {
        profile[k] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      }
      noiseFrames++;
    }
    if (noiseFrames > 0) {
      for (let k = 0; k < profile.length; k++) profile[k] /= noiseFrames;
    }
  }

  const yieldEvery = Math.max(1, Math.floor((sr * 0.35) / hop));
  let frames = 0;

  for (let start = 0; start + frameSize <= data.length; start += hop) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < frameSize; i++) re[i] = data[start + i] * window[i];
    fftRadix2(re, im, false);

    for (let k = 0; k <= bins; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const clean = Math.max(0, mag - profile[k < bins ? k : bins - 1] * strength);
      const scale = mag > 1e-8 ? clean / mag : 0;
      re[k] *= scale;
      im[k] *= scale;
      if (k > 0 && k < bins) {
        re[frameSize - k] = re[k];
        im[frameSize - k] = -im[k];
      }
    }
    im[0] = 0;
    im[bins] = 0;

    fftRadix2(re, im, true);

    const wetMix = strength * 0.45;
    for (let i = 0; i < frameSize; i++) {
      const dry = data[start + i] * window[i];
      const wet = re[i];
      const syn = dry * (1 - wetMix) + wet * wetMix;
      out[start + i] += syn * window[i];
      winSum[start + i] += window[i] * window[i];
    }

    frames++;
    if (frames % yieldEvery === 0) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  for (let i = 0; i < out.length; i++) {
    out[i] = winSum[i] > 0.1 ? out[i] / winSum[i] : data[i];
  }
  return { out, noiseMag: profile };
}

function deClick(data: Float32Array, amount: number): Float32Array {
  if (amount < 0.05) return data;
  const out = new Float32Array(data);
  const thr = 0.35 - amount * 0.2;
  for (let i = 2; i < data.length - 2; i++) {
    const prev = data[i - 1];
    const next = data[i + 1];
    const pred = (prev + next) * 0.5;
    if (Math.abs(data[i] - pred) > thr && Math.abs(data[i]) > Math.abs(prev) && Math.abs(data[i]) > Math.abs(next)) {
      out[i] = pred * (0.4 + amount * 0.4) + data[i] * (0.6 - amount * 0.4);
    }
  }
  return out;
}

async function notchHum(buffer: AudioBuffer, freq: number, amount: number): Promise<AudioBuffer> {
  if (amount < 0.05) return buffer;
  let out = buffer;
  const depths = [1, 2, 3];
  for (const h of depths) {
    const f = freq * h;
    if (f > buffer.sampleRate * 0.45) break;
    const gain = -amount * (8 / h);
    const ctx = new OfflineAudioContext(out.numberOfChannels, out.length, out.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = out;
    const filter = ctx.createBiquadFilter();
    filter.type = 'notch';
    filter.frequency.value = f;
    filter.Q.value = 8 + amount * 20;
    // notch ignores gain in WebAudio for type notch in some browsers — use peaking cut
    filter.type = 'peaking';
    filter.gain.value = gain;
    filter.Q.value = 12;
    source.connect(filter);
    filter.connect(ctx.destination);
    source.start();
    out = await ctx.startRendering();
  }
  return out;
}

function dePlosive(data: Float32Array, sr: number, amount: number): Float32Array {
  if (amount < 0.05) return data;
  const out = new Float32Array(data.length);
  let lp = 0;
  const coeff = Math.exp((-2 * Math.PI * 120) / sr);
  const attack = 1 - Math.exp(-1 / (sr * 0.001));
  const release = 1 - Math.exp(-1 / (sr * 0.05));
  let env = 0;
  for (let i = 0; i < data.length; i++) {
    lp = data[i] * (1 - coeff) + lp * coeff;
    const abs = Math.abs(lp);
    env += (abs > env ? attack : release) * (abs - env);
    let g = 1;
    if (env > 0.22) g = Math.max(0.4, 0.22 / env);
    g = 1 - (1 - g) * amount;
    out[i] = data[i] * g;
  }
  return out;
}

function lightDereverb(data: Float32Array, sr: number, amount: number): Float32Array {
  if (amount < 0.05) return data;
  const out = new Float32Array(data.length);
  const attack = 1 - Math.exp(-1 / (sr * 0.002));
  const release = 1 - Math.exp(-1 / (sr * (0.08 + (1 - amount) * 0.15)));
  let env = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    env += (abs > env ? attack : release) * (abs - env);
    const gate = env > 0.02 ? 1 : 0.35 + (1 - amount) * 0.4;
    out[i] = data[i] * (1 - amount * 0.35 + amount * 0.35 * gate);
  }
  return out;
}

export async function runAudioRepair(
  buffer: AudioBuffer,
  settings: RepairSettings = defaultRepairSettings,
  onProgress?: (p: number, m: string) => void
): Promise<RepairResult> {
  const notes: string[] = [];
  const stages: string[] = [];
  const sr = buffer.sampleRate;
  let channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(new Float32Array(buffer.getChannelData(ch)));
  }

  onProgress?.(5, 'Removing DC offset...');
  await new Promise((r) => setTimeout(r, 0));
  channels = channels.map(removeDC);
  stages.push('DC');

  onProgress?.(15, 'Soft de-clip...');
  channels = channels.map((c) => softDeclip(c, settings.declip / 100));
  if (settings.declip > 10) notes.push('Softened clipped peaks.');
  stages.push('De-clip');

  onProgress?.(30, 'Noise gate / denoise...');
  await new Promise((r) => setTimeout(r, 0));
  channels = channels.map((c) => noiseGate(c, sr, settings.denoise / 100));
  // Spectral denoise on every channel for full-length tracks — yields keep UI alive
  if (settings.denoise > 20) {
    onProgress?.(40, 'Spectral denoise (all channels)...');
    await new Promise((r) => setTimeout(r, 0));
    let sharedProfile: Float32Array | undefined;
    const denoised: Float32Array[] = [];
    for (let ch = 0; ch < channels.length; ch++) {
      onProgress?.(40 + Math.round((ch / channels.length) * 12), `Spectral denoise ch ${ch + 1}...`);
      const { out, noiseMag } = await spectralDenoise(
        channels[ch],
        sr,
        settings.denoise / 100,
        sharedProfile
      );
      if (!sharedProfile) sharedProfile = noiseMag;
      denoised.push(out);
    }
    channels = denoised;
    notes.push('Spectral denoise + gate applied (full spectrum, all channels).');
  } else if (settings.denoise > 10) {
    notes.push('Noise gate applied.');
  }
  stages.push('Denoise');

  onProgress?.(55, 'De-click...');
  await new Promise((r) => setTimeout(r, 0));
  channels = channels.map((c) => deClick(c, settings.declick / 100));
  if (settings.declick > 10) notes.push('Reduced impulsive clicks.');
  stages.push('De-click');

  let out = createBuffer(channels, sr);

  onProgress?.(70, 'De-hum...');
  await new Promise((r) => setTimeout(r, 0));
  if (settings.dehum > 10) {
    out = await notchHum(out, settings.humFreq, settings.dehum / 100);
    notes.push(`Notched ${settings.humFreq} Hz hum harmonics.`);
    stages.push('De-hum');
  }

  onProgress?.(82, 'De-plosive...');
  await new Promise((r) => setTimeout(r, 0));
  {
    const chs: Float32Array[] = [];
    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      chs.push(dePlosive(new Float32Array(out.getChannelData(ch)), sr, settings.deplosive / 100));
    }
    out = createBuffer(chs, sr);
    if (settings.deplosive > 10) notes.push('Tamed plosive pops.');
    stages.push('De-plosive');
  }

  onProgress?.(92, 'Light de-reverb...');
  await new Promise((r) => setTimeout(r, 0));
  if (settings.dereverb > 10) {
    const chs: Float32Array[] = [];
    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      chs.push(lightDereverb(new Float32Array(out.getChannelData(ch)), sr, settings.dereverb / 100));
    }
    out = createBuffer(chs, sr);
    notes.push('Shortened residual room tail.');
    stages.push('De-reverb');
  }

  if (notes.length === 0) notes.push('Light cleanup pass completed.');
  onProgress?.(100, 'Repair complete!');
  return { buffer: out, notes, stages };
}
