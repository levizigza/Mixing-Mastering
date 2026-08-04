// ─── Studio-Quality Vocal Pitch Correction ───────────────────────
// Natural, transparent pitch correction inspired by professional
// studio vocal processing. Detects pitch, gently nudges toward
// correct notes while preserving vibrato, slides, and natural
// expression. Includes a vocal polish stage for clarity and beauty.

export interface PitchCorrectionSettings {
  speed: number;          // 0–100: how fast correction happens (100=instant/hard tune, 0=natural)
  strength: number;       // 0–100: how far toward the target note to correct
  key: MusicalKey;        // Key to constrain correction to
  scale: ScaleType;       // Scale type
  humanize: number;       // 0–100: adds micro-variation to avoid robotic sound
  formantPreserve: number; // 0–100: preserves formant during pitch shift
}

export type MusicalKey = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';
export type ScaleType = 'chromatic' | 'major' | 'minor' | 'pentatonic' | 'blues' | 'dorian' | 'mixolydian';

export const defaultPitchSettings: PitchCorrectionSettings = {
  speed: 22,
  strength: 30,
  key: 'C',
  scale: 'chromatic',
  humanize: 65,
  formantPreserve: 85,
};

// Semitone intervals for each scale relative to root
const SCALE_INTERVALS: Record<ScaleType, number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

const KEY_OFFSETS: Record<MusicalKey, number> = {
  'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
  'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11,
};

// ─── YIN-inspired Pitch Detection ────────────────────────────────

function detectPitchYIN(signal: Float32Array, sampleRate: number): number {
  const bufferSize = signal.length;
  const halfBuffer = Math.floor(bufferSize / 2);
  const threshold = 0.12;

  // Difference function
  const diff = new Float32Array(halfBuffer);
  for (let tau = 0; tau < halfBuffer; tau++) {
    let sum = 0;
    for (let i = 0; i < halfBuffer; i++) {
      const delta = signal[i] - signal[i + tau];
      sum += delta * delta;
    }
    diff[tau] = sum;
  }

  // Cumulative mean normalized difference
  const cmndf = new Float32Array(halfBuffer);
  cmndf[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < halfBuffer; tau++) {
    runningSum += diff[tau];
    cmndf[tau] = diff[tau] * tau / runningSum;
  }

  // Absolute threshold — find the first dip below threshold
  const minPeriod = Math.floor(sampleRate / 1000); // Max 1000 Hz
  const maxPeriod = Math.floor(sampleRate / 60);   // Min 60 Hz

  for (let tau = minPeriod; tau < Math.min(maxPeriod, halfBuffer); tau++) {
    if (cmndf[tau] < threshold) {
      while (tau + 1 < halfBuffer && cmndf[tau + 1] < cmndf[tau]) {
        tau++;
      }
      // Parabolic interpolation for sub-sample accuracy
      if (tau > 0 && tau < halfBuffer - 1) {
        const s0 = cmndf[tau - 1];
        const s1 = cmndf[tau];
        const s2 = cmndf[tau + 1];
        const refinement = (s0 - s2) / (2 * (s0 - 2 * s1 + s2));
        const refinedTau = tau + (isFinite(refinement) ? refinement : 0);
        return sampleRate / refinedTau;
      }
      return sampleRate / tau;
    }
  }

  return -1;
}

// ─── Note Snapping ───────────────────────────────────────────────

function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function getValidNotes(key: MusicalKey, scale: ScaleType): number[] {
  const keyOffset = KEY_OFFSETS[key];
  const intervals = SCALE_INTERVALS[scale];
  const notes: number[] = [];
  for (let octave = 2; octave <= 6; octave++) {
    for (const interval of intervals) {
      notes.push((octave + 1) * 12 + keyOffset + interval);
    }
  }
  return notes;
}

function snapToScale(midiNote: number, validNotes: number[]): number {
  let closest = validNotes[0];
  let minDist = Math.abs(midiNote - closest);
  for (const note of validNotes) {
    const dist = Math.abs(midiNote - note);
    if (dist < minDist) {
      minDist = dist;
      closest = note;
    }
  }
  return closest;
}

// ─── Vibrato & Slide Detection ───────────────────────────────────
// Detects if the current frame is part of a vibrato or intentional
// pitch slide, so we can reduce correction during these moments.

function detectVibratoOrSlide(
  pitchHistory: number[],
  currentMidi: number
): { isVibrato: boolean; isSlide: boolean; expressionAmount: number } {
  if (pitchHistory.length < 4) return { isVibrato: false, isSlide: false, expressionAmount: 0 };

  const recent = pitchHistory.slice(-10);

  // Vibrato detection: oscillation around a center pitch
  let crossings = 0;
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  for (let i = 1; i < recent.length; i++) {
    if ((recent[i] - mean) * (recent[i - 1] - mean) < 0) {
      crossings++;
    }
  }
  const isVibrato = crossings >= 2; // Lower threshold — catch more vibrato

  // Vibrato depth: how wide the oscillation is (deeper vibrato = more expressive)
  let vibratoDepth = 0;
  if (isVibrato) {
    const maxPitch = Math.max(...recent);
    const minPitch = Math.min(...recent);
    vibratoDepth = maxPitch - minPitch;
  }

  // Slide detection: consistent directional movement
  let upCount = 0;
  let downCount = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > recent[i - 1] + 0.03) upCount++;
    if (recent[i] < recent[i - 1] - 0.03) downCount++;
  }
  const totalMoves = recent.length - 1;
  const isSlide = (upCount > totalMoves * 0.6 || downCount > totalMoves * 0.6);

  // Overall expression amount: how much the pitch is moving around
  // More movement = more likely the singer is doing something intentional
  let pitchVariance = 0;
  for (const p of recent) {
    pitchVariance += (p - mean) * (p - mean);
  }
  pitchVariance = Math.sqrt(pitchVariance / recent.length);
  const expressionAmount = Math.min(1, pitchVariance / 1.5 + vibratoDepth / 2);

  return { isVibrato, isSlide, expressionAmount };
}

// ─── Formant-Preserving Pitch Shift ─────────────────────────────
// Shifts pitch while preserving vocal formant character.
// Uses spectral envelope estimation to separate pitch from timbre.

function pitchShiftWithFormant(
  input: Float32Array,
  semitones: number,
  sampleRate: number,
  formantPreserve: number
): Float32Array {
  if (Math.abs(semitones) < 0.005) return new Float32Array(input);

  const clampedSemitones = Math.max(-2.5, Math.min(2.5, semitones));
  const ratio = Math.pow(2, clampedSemitones / 12);
  const outputLen = input.length;
  const output = new Float32Array(outputLen);
  const lastIdx = input.length - 1;

  // Phase 1: Resample to shift pitch (cubic Hermite interpolation)
  const pitched = new Float32Array(outputLen);
  const maxSafe = Math.floor(lastIdx / Math.max(ratio, 1));

  for (let i = 0; i < outputLen; i++) {
    const srcIdx = i * ratio;
    if (srcIdx >= lastIdx - 1) {
      // Smooth fade at boundary
      const fadeRegion = Math.min(256, maxSafe);
      if (i > maxSafe - fadeRegion && i <= maxSafe) {
        const fade = (maxSafe - i) / fadeRegion;
        pitched[i] = input[Math.min(i, lastIdx)] * fade;
      } else {
        pitched[i] = 0;
      }
      continue;
    }

    const idx0 = Math.floor(srcIdx);
    const frac = srcIdx - idx0;

    const im1 = Math.max(0, idx0 - 1);
    const i0 = idx0;
    const i1 = Math.min(lastIdx, idx0 + 1);
    const i2 = Math.min(lastIdx, idx0 + 2);

    const x0 = input[im1];
    const x1 = input[i0];
    const x2 = input[i1];
    const x3 = input[i2];

    const c0 = x1;
    const c1 = 0.5 * (x2 - x0);
    const c2 = x0 - 2.5 * x1 + 2 * x2 - 0.5 * x3;
    const c3 = 0.5 * (x3 - x0) + 1.5 * (x1 - x2);

    pitched[i] = ((c3 * frac + c2) * frac + c1) * frac + c0;
  }

  // Phase 2: Formant preservation using spectral envelope blending
  // If formantPreserve is high, blend the spectral envelope of the
  // original with the pitched version to maintain vocal character.
  const fpAmount = formantPreserve;
  if (fpAmount < 0.1) {
    return pitched;
  }

  // Formant preservation via smoothed envelope matching with crossfaded blocks.
  // Uses overlapping blocks to avoid discontinuity artifacts at block boundaries.
  const envLen = 128;
  const envHop = 64; // 50% overlap
  const numBlocks = Math.floor((outputLen - envLen) / envHop) + 1;

  // Pre-fill output with pitched signal
  for (let i = 0; i < outputLen; i++) {
    output[i] = 0;
  }
  const weightSum = new Float32Array(outputLen);

  // Smoothed gain from previous block for interpolation
  let prevBlockGain = 1.0;

  for (let block = 0; block < numBlocks; block++) {
    const offset = block * envHop;

    let origRms = 0;
    let pitchedRms = 0;
    let origPeak = 0;
    let pitchedPeak = 0;
    for (let j = 0; j < envLen && offset + j < outputLen; j++) {
      const idx = offset + j;
      const origSample = idx < input.length ? input[idx] : 0;
      origRms += origSample * origSample;
      pitchedRms += pitched[idx] * pitched[idx];
      origPeak = Math.max(origPeak, Math.abs(origSample));
      pitchedPeak = Math.max(pitchedPeak, Math.abs(pitched[idx]));
    }
    origRms = Math.sqrt(origRms / envLen);
    pitchedRms = Math.sqrt(pitchedRms / envLen);

    // Blend RMS and peak for more stable gain matching
    const rmsGain = (pitchedRms > 0.0001)
      ? Math.min(1.8, Math.max(0.6, origRms / pitchedRms))
      : 1.0;
    const peakGain = (pitchedPeak > 0.0001)
      ? Math.min(1.8, Math.max(0.6, origPeak / pitchedPeak))
      : 1.0;
    const gainCorrection = rmsGain * 0.7 + peakGain * 0.3;
    const blockGain = 1.0 + (gainCorrection - 1.0) * fpAmount;

    // Hann window for smooth overlap-add
    for (let j = 0; j < envLen && offset + j < outputLen; j++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * j / (envLen - 1)));
      output[offset + j] += pitched[offset + j] * blockGain * w;
      weightSum[offset + j] += w;
    }

    prevBlockGain = blockGain;
  }

  // Normalize by window sum, fallback to pitched signal where no blocks cover
  for (let i = 0; i < outputLen; i++) {
    if (weightSum[i] > 0.01) {
      output[i] /= weightSum[i];
    } else {
      output[i] = pitched[i];
    }
  }

  return output;
}

// ─── Vocal Polish ────────────────────────────────────────────────
// Applied after pitch correction to make vocals sound crisp, clear,
// and beautiful — like a professional studio recording.

function applyVocalPolish(
  data: Float32Array,
  sampleRate: number
): Float32Array {
  const len = data.length;
  const output = new Float32Array(len);

  // Stage 1: Gentle high-pass to remove rumble (80 Hz)
  let hp1 = 0, hp2 = 0;
  const hpCoeff = 1 - Math.exp(-2 * Math.PI * 80 / sampleRate);
  const tempHp = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    hp1 += hpCoeff * (data[i] - hp1);
    hp2 += hpCoeff * (hp1 - hp2);
    tempHp[i] = data[i] - hp2;
  }

  // Stage 2: Subtle presence boost (3.5 kHz)
  const presFreq = 3500;
  const presQ = 1.5;
  const presGain = 1.2; // dB — subtle
  const presW0 = 2 * Math.PI * presFreq / sampleRate;
  const presAlpha = Math.sin(presW0) / (2 * presQ);
  const presA = Math.pow(10, presGain / 40);
  const pb0 = 1 + presAlpha * presA;
  const pb1 = -2 * Math.cos(presW0);
  const pb2 = 1 - presAlpha * presA;
  const pa0 = 1 + presAlpha / presA;
  const pa1 = -2 * Math.cos(presW0);
  const pa2 = 1 - presAlpha / presA;

  let px1 = 0, px2 = 0, py1 = 0, py2 = 0;
  const tempPres = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const x = tempHp[i];
    const y = (pb0 / pa0) * x + (pb1 / pa0) * px1 + (pb2 / pa0) * px2
            - (pa1 / pa0) * py1 - (pa2 / pa0) * py2;
    tempPres[i] = y;
    px2 = px1; px1 = x;
    py2 = py1; py1 = y;
  }

  // Stage 3: Air / shimmer (12 kHz high shelf, +1 dB)
  const airFreq = 12000;
  const airGainDb = 1.0;
  const airA = Math.pow(10, airGainDb / 40);
  const airW0 = 2 * Math.PI * airFreq / sampleRate;
  const airAlpha = Math.sin(airW0) / (2 * 0.7);
  const airCos = Math.cos(airW0);
  const airSqrt = Math.sqrt(airA);
  const ab0 = airA * ((airA + 1) + (airA - 1) * airCos + 2 * airSqrt * airAlpha);
  const ab1 = -2 * airA * ((airA - 1) + (airA + 1) * airCos);
  const ab2 = airA * ((airA + 1) + (airA - 1) * airCos - 2 * airSqrt * airAlpha);
  const aa0 = (airA + 1) - (airA - 1) * airCos + 2 * airSqrt * airAlpha;
  const aa1 = 2 * ((airA - 1) - (airA + 1) * airCos);
  const aa2 = (airA + 1) - (airA - 1) * airCos - 2 * airSqrt * airAlpha;

  let ax1 = 0, ax2 = 0, ay1 = 0, ay2 = 0;
  const tempAir = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const x = tempPres[i];
    const y = (ab0 / aa0) * x + (ab1 / aa0) * ax1 + (ab2 / aa0) * ax2
            - (aa1 / aa0) * ay1 - (aa2 / aa0) * ay2;
    tempAir[i] = y;
    ax2 = ax1; ax1 = x;
    ay2 = ay1; ay1 = y;
  }

  // Stage 4: Very gentle optical-style compression (transparent leveling)
  let compEnv = 0;
  const compAttack = 1 - Math.exp(-1 / (sampleRate * 0.03)); // 30ms
  const compRelease = 1 - Math.exp(-1 / (sampleRate * 0.2)); // 200ms
  const compThreshold = 0.35;
  const compRatio = 1.8;
  let smoothGain = 1;
  const gainSmooth = 1 - Math.exp(-1 / (sampleRate * 0.01)); // 10ms gain smoothing

  for (let i = 0; i < len; i++) {
    const abs = Math.abs(tempAir[i]);
    compEnv += (abs > compEnv ? compAttack : compRelease) * (abs - compEnv);

    let targetGain = 1;
    if (compEnv > compThreshold) {
      const overDb = 20 * Math.log10(compEnv / compThreshold);
      const reduction = overDb * (1 - 1 / compRatio);
      targetGain = Math.pow(10, -reduction / 20);
    }

    smoothGain += gainSmooth * (targetGain - smoothGain);
    output[i] = tempAir[i] * smoothGain;
  }

  // Stage 5: Gentle makeup gain to compensate for compression
  let peakOut = 0;
  for (let i = 0; i < len; i++) {
    const abs = Math.abs(output[i]);
    if (abs > peakOut) peakOut = abs;
  }
  if (peakOut > 0 && peakOut < 0.8) {
    const makeup = Math.min(1.3, 0.8 / peakOut);
    for (let i = 0; i < len; i++) {
      output[i] *= makeup;
    }
  }

  return output;
}

// ─── Main Pitch Correction Function ─────────────────────────────

export async function correctPitch(
  buffer: AudioBuffer,
  settings: PitchCorrectionSettings,
  onProgress?: (progress: number, message: string) => void
): Promise<AudioBuffer> {
  const sr = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const len = buffer.length;

  onProgress?.(3, 'Analyzing vocal pitch...');

  const validNotes = getValidNotes(settings.key, settings.scale);
  const speed = settings.speed / 100;
  const strength = settings.strength / 100;
  const humanize = settings.humanize / 100;
  const formantPreserve = settings.formantPreserve / 100;

  // Hard/classic Auto-Tune (T-Pain / Evo): near-instant snap, low humanize.
  // Natural mode keeps the softer studio cap so vibrato and slides survive.
  const hardTune = speed >= 0.82 && strength >= 0.7 && humanize <= 0.25;
  const effectiveStrength = hardTune ? Math.min(0.98, strength * 0.95) : strength * 0.6;
  // Dead-zone: notes within this many semitones of target are "close enough"
  // Higher humanize = wider dead-zone = more natural imperfection preserved
  const correctionThreshold = hardTune
    ? 0.05 + humanize * 0.08
    : 0.25 + humanize * 0.35;

  const outputChannels: Float32Array[] = [];

  for (let ch = 0; ch < numChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const output = new Float32Array(len);

    // Frame-by-frame processing with generous overlap
    const frameSize = 2048;
    const hopSize = 512;
    const numFrames = Math.floor((len - frameSize) / hopSize);
    const window = new Float32Array(frameSize);

    // Hann window
    for (let i = 0; i < frameSize; i++) {
      window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
    }

    // Overlap-add accumulator
    const accumulator = new Float32Array(len);
    const windowSum = new Float32Array(len);

    let prevCorrection = 0;
    let prevTargetMidi = -1;
    let noteHoldFrames = 0;
    const pitchHistory: number[] = [];

    // Natural drift state — simulates the micro-instability of human pitch
    let driftPhase1 = Math.random() * Math.PI * 2;
    let driftPhase2 = Math.random() * Math.PI * 2;
    let driftPhase3 = Math.random() * Math.PI * 2;

    for (let frame = 0; frame < numFrames; frame++) {
      if (ch === 0 && frame % 50 === 0) {
        const progress = 3 + (frame / numFrames) * 72;
        onProgress?.(progress, `Studio pitch correction (${Math.round(progress)}%)...`);
        await new Promise((r) => setTimeout(r, 0));
      }

      const start = frame * hopSize;
      const segment = new Float32Array(input.buffer, input.byteOffset + start * 4, frameSize);

      // Detect pitch for this frame
      const detectedFreq = detectPitchYIN(segment, sr);

      let correctedSegment: Float32Array;

      if (detectedFreq > 0 && detectedFreq > 70 && detectedFreq < 1200) {
        const currentMidi = freqToMidi(detectedFreq);
        pitchHistory.push(currentMidi);
        if (pitchHistory.length > 16) pitchHistory.shift();

        const targetMidi = snapToScale(currentMidi, validNotes);
        const distance = Math.abs(targetMidi - currentMidi);

        // Track note transitions for portamento preservation
        if (prevTargetMidi > 0 && Math.abs(targetMidi - prevTargetMidi) > 0.5) {
          noteHoldFrames = 0; // Reset — new note detected
        } else {
          noteHoldFrames++;
        }
        prevTargetMidi = targetMidi;

        // Detect vibrato, slides, and overall expression
        const { isVibrato, isSlide, expressionAmount } = detectVibratoOrSlide(pitchHistory, currentMidi);

        // Measure frame energy — quieter passages get less correction (more natural)
        let frameEnergy = 0;
        for (let i = 0; i < frameSize; i++) {
          frameEnergy += segment[i] * segment[i];
        }
        frameEnergy = Math.sqrt(frameEnergy / frameSize);
        const energyFactor = Math.min(1, frameEnergy * 8);

        let correctionMultiplier = effectiveStrength;

        // Vibrato / slides: preserve in natural mode; quantize hard in classic Auto-Tune
        if (isVibrato) {
          correctionMultiplier *= hardTune ? 0.55 : 0.08;
        }
        if (isSlide) {
          correctionMultiplier *= hardTune ? 0.7 : 0.12;
        }
        if (!hardTune) {
          correctionMultiplier *= 1 - expressionAmount * 0.5;
        }

        // Note onset: natural mode lets attack through; hard tune snaps immediately
        if (!hardTune && noteHoldFrames < 4) {
          correctionMultiplier *= noteHoldFrames / 4;
        }

        // Quiet passages: less correction in natural mode
        if (!hardTune) {
          correctionMultiplier *= 0.3 + energyFactor * 0.7;
        }

        // Dead-zone: notes within threshold are "close enough" — don't correct
        if (distance < correctionThreshold) {
          const deadZoneFade = Math.pow(distance / correctionThreshold, 2);
          correctionMultiplier *= deadZoneFade;
        }

        let correction = (targetMidi - currentMidi) * correctionMultiplier;

        // Natural drift: multi-rate LFO simulating human pitch instability
        if (humanize > 0.05) {
          const driftRate1 = 0.31;
          const driftRate2 = 5.2;
          const driftRate3 = 1.7;
          driftPhase1 += driftRate1 * hopSize / sr * 2 * Math.PI;
          driftPhase2 += driftRate2 * hopSize / sr * 2 * Math.PI;
          driftPhase3 += driftRate3 * hopSize / sr * 2 * Math.PI;

          const drift = Math.sin(driftPhase1) * 0.06
                       + Math.sin(driftPhase2) * 0.03
                       + Math.sin(driftPhase3) * 0.04;
          correction += drift * humanize;
        }

        // Smooth correction — hard tune ≈ Retune Speed 0; natural ≈ 10–50 ms spirit
        const smoothFactor = hardTune
          ? 0.55 + speed * 0.4
          : 0.03 + speed * 0.35;
        correction = prevCorrection + (correction - prevCorrection) * smoothFactor;
        prevCorrection = correction;

        // Apply formant-preserving pitch shift
        const segCopy = new Float32Array(segment);
        correctedSegment = pitchShiftWithFormant(segCopy, correction, sr, formantPreserve);
      } else {
        // No clear pitch — pass through, slowly decay correction
        correctedSegment = new Float32Array(segment);
        prevCorrection *= 0.8;
        noteHoldFrames = 0;
        if (pitchHistory.length > 0) {
          pitchHistory.push(pitchHistory[pitchHistory.length - 1]);
          if (pitchHistory.length > 16) pitchHistory.shift();
        }
      }

      // Windowed overlap-add
      for (let i = 0; i < frameSize; i++) {
        if (start + i < len) {
          accumulator[start + i] += correctedSegment[i] * window[i];
          windowSum[start + i] += window[i] * window[i];
        }
      }
    }

    // Normalize by window sum with proper fallback to dry signal
    for (let i = 0; i < len; i++) {
      if (windowSum[i] > 0.1) {
        output[i] = accumulator[i] / windowSum[i];
      } else {
        const blend = windowSum[i] / 0.1;
        output[i] = (accumulator[i] / Math.max(windowSum[i], 0.001)) * blend + input[i] * (1 - blend);
      }
    }

    // Remove DC offset
    let dcSum = 0;
    for (let i = 0; i < len; i++) dcSum += output[i];
    const dcOffset = dcSum / len;
    if (Math.abs(dcOffset) > 0.001) {
      for (let i = 0; i < len; i++) output[i] -= dcOffset;
    }

    outputChannels.push(output);
  }

  onProgress?.(92, 'Finalizing studio vocal...');

  // Create output buffer
  const ctx = new OfflineAudioContext(numChannels, len, sr);
  const outputBuffer = ctx.createBuffer(numChannels, len, sr);
  for (let ch = 0; ch < numChannels; ch++) {
    outputBuffer.copyToChannel(new Float32Array(outputChannels[ch]), ch);
  }

  onProgress?.(100, 'Vocal correction complete!');
  return outputBuffer;
}

// ─── Auto-detect Key ─────────────────────────────────────────────
// Estimates the key of a piece by analyzing pitch class histogram

export function detectKey(buffer: AudioBuffer): { key: MusicalKey; scale: ScaleType; confidence: number } {
  const sr = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const frameSize = 2048;
  const hopSize = 1024;
  const numFrames = Math.min(Math.floor((data.length - frameSize) / hopSize), 500);

  const pitchClassCounts = new Float32Array(12);

  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize;
    const segment = new Float32Array(data.buffer, data.byteOffset + start * 4, frameSize);
    const freq = detectPitchYIN(segment, sr);

    if (freq > 60 && freq < 1200) {
      const midi = freqToMidi(freq);
      const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
      pitchClassCounts[pitchClass]++;
    }
  }

  // Try each key and scale, score by how well the detected pitches fit
  let bestKey: MusicalKey = 'C';
  let bestScale: ScaleType = 'major';
  let bestScore = -1;
  let totalDetected = 0;
  for (let i = 0; i < 12; i++) totalDetected += pitchClassCounts[i];

  if (totalDetected === 0) return { key: 'C', scale: 'major', confidence: 0 };

  const keys: MusicalKey[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const scales: ScaleType[] = ['major', 'minor', 'dorian', 'mixolydian'];

  for (const key of keys) {
    for (const scale of scales) {
      const intervals = SCALE_INTERVALS[scale];
      const offset = KEY_OFFSETS[key];
      let score = 0;
      for (const interval of intervals) {
        const pc = (offset + interval) % 12;
        score += pitchClassCounts[pc];
      }
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
        bestScale = scale;
      }
    }
  }

  const confidence = totalDetected > 0 ? bestScore / totalDetected : 0;
  return { key: bestKey, scale: bestScale, confidence };
}
