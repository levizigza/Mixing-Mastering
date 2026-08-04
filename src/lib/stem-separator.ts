// ─── DSP-Based Stem Separator ─────────────────────────────────────
// Splits a full mix into estimated stems using pure Web Audio API DSP:
//   - Mid/side decomposition (center vs panned content)
//   - Frequency band splitting (bass / mids / highs via BiquadFilter)
//   - Transient detection via envelope following (percussive extraction)
//   - Residual computation (instruments = original − bass − vocals − drums)
//
// No ML models, no external dependencies, runs entirely in the browser.

export interface SeparatedStems {
  vocals: AudioBuffer;
  drums: AudioBuffer;
  bass: AudioBuffer;
  instruments: AudioBuffer;
}

// ─── Buffer Utilities ─────────────────────────────────────────────

function createBuffer(
  channels: Float32Array[],
  sampleRate: number
): AudioBuffer {
  const length = channels[0].length;
  const ctx = new OfflineAudioContext(channels.length, length, sampleRate);
  const buffer = ctx.createBuffer(channels.length, length, sampleRate);
  for (let ch = 0; ch < channels.length; ch++) {
    buffer.copyToChannel(new Float32Array(channels[ch]), ch);
  }
  return buffer;
}

async function applyFilter(
  buffer: AudioBuffer,
  type: BiquadFilterType,
  frequency: number,
  Q?: number
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  if (Q !== undefined) filter.Q.value = Q;
  source.connect(filter);
  filter.connect(ctx.destination);
  source.start();
  return ctx.startRendering();
}

// Two-stage bandpass: highpass → lowpass for a cleaner passband
async function applyBandpass(
  buffer: AudioBuffer,
  lowCut: number,
  highCut: number
): Promise<AudioBuffer> {
  const hp = await applyFilter(buffer, 'highpass', lowCut, 0.7);
  return applyFilter(hp, 'lowpass', highCut, 0.7);
}

// ─── Mid / Side Decomposition ────────────────────────────────────

function getMidSide(buffer: AudioBuffer): { mid: Float32Array; side: Float32Array } {
  const len = buffer.length;
  if (buffer.numberOfChannels < 2) {
    return { mid: buffer.getChannelData(0).slice(), side: new Float32Array(len) };
  }
  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);
  const mid = new Float32Array(len);
  const side = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    mid[i] = (L[i] + R[i]) * 0.5;
    side[i] = (L[i] - R[i]) * 0.5;
  }
  return { mid, side };
}

// ─── Transient Detection ─────────────────────────────────────────
// Envelope-following onset detector that produces a smooth gain mask
// with short attack / moderate release windows around each transient.

function createTransientMask(signal: Float32Array, sampleRate: number): Float32Array {
  const len = signal.length;
  const mask = new Float32Array(len);

  // Envelope follower
  const envelope = new Float32Array(len);
  let env = 0;
  const attCoeff = 1 - Math.exp(-1 / (sampleRate * 0.0008));
  const relCoeff = 1 - Math.exp(-1 / (sampleRate * 0.015));
  for (let i = 0; i < len; i++) {
    const abs = Math.abs(signal[i]);
    env += (abs > env ? attCoeff : relCoeff) * (abs - env);
    envelope[i] = env;
  }

  // Onset detection
  const hopSize = Math.floor(sampleRate * 0.008);
  const attackSamples = Math.floor(sampleRate * 0.003);
  const releaseSamples = Math.floor(sampleRate * 0.07);

  // Adaptive threshold: use local RMS as baseline
  const blockSize = Math.floor(sampleRate * 0.1);
  for (let i = hopSize; i < len; i += hopSize) {
    const delta = envelope[i] - envelope[i - hopSize];
    // Local floor — only trigger on meaningful jumps
    const blockStart = Math.max(0, i - blockSize);
    let localRMS = 0;
    for (let j = blockStart; j < i; j++) localRMS += envelope[j] * envelope[j];
    localRMS = Math.sqrt(localRMS / (i - blockStart || 1));
    const adaptiveThreshold = Math.max(0.015, localRMS * 0.6);

    if (delta > adaptiveThreshold && envelope[i] > 0.008) {
      // Write smooth attack/release window
      const aStart = Math.max(0, i - attackSamples);
      const rEnd = Math.min(len, i + releaseSamples);
      for (let j = aStart; j < i; j++) {
        mask[j] = Math.max(mask[j], (j - aStart) / attackSamples);
      }
      for (let j = i; j < rEnd; j++) {
        const t = 1 - (j - i) / releaseSamples;
        mask[j] = Math.max(mask[j], t * t); // Quadratic release curve
      }
    }
  }

  return mask;
}

// ─── Main Separator ──────────────────────────────────────────────

export async function separateStems(
  buffer: AudioBuffer,
  onProgress?: (progress: number, message: string) => void
): Promise<SeparatedStems> {
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const isStereo = buffer.numberOfChannels >= 2;

  onProgress?.(5, 'Decomposing center and side signals...');

  const { mid, side } = getMidSide(buffer);
  const midBuffer = createBuffer([mid], sr);

  // ── Bass: lowpass 180 Hz on center channel ──────────────────
  onProgress?.(12, 'Isolating bass frequencies...');
  const bassFiltered = await applyFilter(midBuffer, 'lowpass', 180, 0.7);
  const bassData = bassFiltered.getChannelData(0);

  // ── Vocals: bandpass 200–8 000 Hz on center channel ────────
  onProgress?.(25, 'Extracting vocal range from center...');
  const vocalFiltered = await applyBandpass(midBuffer, 200, 8000);
  const vocalData = vocalFiltered.getChannelData(0);

  // ── Drums: transient mask on full mono + high-freq content ──
  onProgress?.(40, 'Detecting percussive transients...');
  await new Promise((r) => setTimeout(r, 0));
  const fullMono = new Float32Array(len);
  if (isStereo) {
    const L = buffer.getChannelData(0);
    const R = buffer.getChannelData(1);
    for (let i = 0; i < len; i++) fullMono[i] = (L[i] + R[i]) * 0.5;
  } else {
    fullMono.set(buffer.getChannelData(0));
  }
  const transientMask = createTransientMask(fullMono, sr);

  onProgress?.(55, 'Extracting high-frequency content...');
  const fullMonoBuffer = createBuffer([fullMono], sr);
  const highFiltered = await applyFilter(fullMonoBuffer, 'highpass', 8000, 0.7);
  const highData = highFiltered.getChannelData(0);

  // Drums = transient-gated full signal + cymbal/hi-hat air
  const drumMono = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    drumMono[i] = fullMono[i] * transientMask[i] * 0.85 + highData[i] * 0.55;
  }

  // ── Instruments: residual ───────────────────────────────────
  // Remove bass, vocals, and drums from mid channel, then highpass to eliminate
  // any remaining low-mid bleed that causes muddiness
  onProgress?.(68, 'Computing instrument residual...');
  await new Promise((r) => setTimeout(r, 0));
  const residualMid = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    residualMid[i] = mid[i] - bassData[i] - vocalData[i] - mid[i] * transientMask[i] * 0.85;
  }

  // Apply a 150Hz highpass to the instrument residual to remove leftover low-mud bleed
  const residualBuffer = createBuffer([residualMid], sr);
  const cleanInstruments = await applyFilter(residualBuffer, 'highpass', 150, 0.7);
  const cleanInstData = cleanInstruments.getChannelData(0);
  for (let i = 0; i < len; i++) {
    residualMid[i] = cleanInstData[i];
  }

  // ── Build stereo AudioBuffers ──────────────────────────────
  onProgress?.(80, 'Building stereo stems...');
  await new Promise((r) => setTimeout(r, 0));

  const bassBuffer = createBuffer(
    isStereo ? [bassData.slice(), bassData.slice()] : [bassData.slice()],
    sr
  );

  const vocalsBuffer = createBuffer(
    isStereo ? [vocalData.slice(), vocalData.slice()] : [vocalData.slice()],
    sr
  );

  let drumsBuffer: AudioBuffer;
  if (isStereo) {
    const L = buffer.getChannelData(0);
    const R = buffer.getChannelData(1);
    const drumL = new Float32Array(len);
    const drumR = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      drumL[i] = L[i] * transientMask[i] * 0.75 + highData[i] * 0.45;
      drumR[i] = R[i] * transientMask[i] * 0.75 + highData[i] * 0.45;
    }
    drumsBuffer = createBuffer([drumL, drumR], sr);
  } else {
    drumsBuffer = createBuffer([drumMono.slice()], sr);
  }

  let instrumentsBuffer: AudioBuffer;
  if (isStereo) {
    const instL = new Float32Array(len);
    const instR = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      instL[i] = side[i] + residualMid[i] * 0.5;
      instR[i] = -side[i] + residualMid[i] * 0.5;
    }
    instrumentsBuffer = createBuffer([instL, instR], sr);
  } else {
    instrumentsBuffer = createBuffer([residualMid.slice()], sr);
  }

  onProgress?.(95, 'Stem separation complete!');

  return {
    vocals: vocalsBuffer,
    drums: drumsBuffer,
    bass: bassBuffer,
    instruments: instrumentsBuffer,
  };
}
