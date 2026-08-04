// ─── Dynamic Arc / Musical Journey System ───────────────────────────
// Analyzes a track's energy contour over time and applies subtle but
// meaningful automation to create a sense of musical journey:
//
//   - Volume swells: quieter verses, louder choruses
//   - Filter movement: darker during builds, brighter at peaks
//   - Stereo width: narrower during intimate moments, wider at climaxes
//   - Transient emphasis: sharper hits during high-energy sections
//
// The system detects sections by analyzing energy in overlapping windows,
// then creates a smooth automation curve that enhances the existing
// dynamics rather than fighting them.

export interface ArcSection {
  startSample: number;
  endSample: number;
  energy: number;       // 0-1 normalized energy
  isClimb: boolean;     // energy rising
  isPeak: boolean;      // local maximum
  isDrop: boolean;      // energy falling significantly
  isQuiet: boolean;     // low energy section (verse/bridge)
}

export interface ArcAnalysis {
  sections: ArcSection[];
  overallArc: 'building' | 'peaked' | 'dynamic' | 'flat';
  peakPositions: number[]; // 0-1 positions where peaks occur
  dynamicRange: number;    // difference between loudest and quietest
}

export interface ArcAutomation {
  gainCurve: Float32Array;      // per-sample gain multiplier
  brightnessCurve: Float32Array; // per-sample high-shelf gain (-1 to +1)
  widthCurve: Float32Array;      // per-sample stereo width multiplier
}

// ─── Energy Analysis ────────────────────────────────────────────────

function analyzeEnergyContour(
  buffer: AudioBuffer,
  windowSeconds: number = 2.0
): Float32Array {
  const sr = buffer.sampleRate;
  const windowSize = Math.floor(sr * windowSeconds);
  const hopSize = Math.floor(windowSize / 2);
  const data = buffer.getChannelData(0);
  const numWindows = Math.floor((data.length - windowSize) / hopSize) + 1;
  const energy = new Float32Array(numWindows);

  for (let w = 0; w < numWindows; w++) {
    const start = w * hopSize;
    let rms = 0;
    for (let i = start; i < start + windowSize && i < data.length; i++) {
      rms += data[i] * data[i];
    }
    energy[w] = Math.sqrt(rms / windowSize);
  }

  // Normalize to 0-1
  let maxE = 0;
  for (let i = 0; i < energy.length; i++) {
    if (energy[i] > maxE) maxE = energy[i];
  }
  if (maxE > 0) {
    for (let i = 0; i < energy.length; i++) {
      energy[i] /= maxE;
    }
  }

  return energy;
}

// ─── Section Detection ──────────────────────────────────────────────

function detectSections(
  energyContour: Float32Array,
  totalSamples: number,
  sampleRate: number,
  windowSeconds: number = 2.0
): ArcSection[] {
  const hopSize = Math.floor(sampleRate * windowSeconds / 2);
  const sections: ArcSection[] = [];
  const numWindows = energyContour.length;

  // Smooth the contour to avoid jitter
  const smoothed = new Float32Array(numWindows);
  const smoothWindow = 3;
  for (let i = 0; i < numWindows; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - smoothWindow); j <= Math.min(numWindows - 1, i + smoothWindow); j++) {
      sum += energyContour[j];
      count++;
    }
    smoothed[i] = sum / count;
  }

  // Calculate average energy for threshold
  let avgEnergy = 0;
  for (let i = 0; i < numWindows; i++) avgEnergy += smoothed[i];
  avgEnergy /= numWindows;

  for (let i = 0; i < numWindows; i++) {
    const startSample = Math.min(i * hopSize, totalSamples);
    const endSample = Math.min((i + 1) * hopSize + Math.floor(sampleRate * windowSeconds / 2), totalSamples);
    const e = smoothed[i];
    const prev = i > 0 ? smoothed[i - 1] : e;
    const next = i < numWindows - 1 ? smoothed[i + 1] : e;

    const isClimb = e > prev + 0.05;
    const isPeak = e >= prev && e >= next && e > avgEnergy * 1.2;
    const isDrop = e < prev - 0.1;
    const isQuiet = e < avgEnergy * 0.6;

    sections.push({ startSample, endSample, energy: e, isClimb, isPeak, isDrop, isQuiet });
  }

  return sections;
}

// ─── Arc Classification ─────────────────────────────────────────────

function classifyArc(sections: ArcSection[]): ArcAnalysis {
  const peaks = sections.filter(s => s.isPeak);
  const peakPositions = peaks.map(s => s.startSample / (sections[sections.length - 1]?.endSample || 1));

  const energies = sections.map(s => s.energy);
  const maxE = Math.max(...energies);
  const minE = Math.min(...energies);
  const dynamicRange = maxE - minE;

  let overallArc: ArcAnalysis['overallArc'] = 'dynamic';
  if (dynamicRange < 0.15) {
    overallArc = 'flat';
  } else if (peaks.length <= 1 && peakPositions[0] > 0.6) {
    overallArc = 'building';
  } else if (peaks.length <= 1 && peakPositions[0] < 0.4) {
    overallArc = 'peaked';
  }

  return { sections, overallArc, peakPositions, dynamicRange };
}

// ─── Automation Generation ──────────────────────────────────────────
// Creates smooth per-sample automation curves based on the arc analysis

function generateAutomation(
  arc: ArcAnalysis,
  totalSamples: number,
  sampleRate: number
): ArcAutomation {
  const gainCurve = new Float32Array(totalSamples);
  const brightnessCurve = new Float32Array(totalSamples);
  const widthCurve = new Float32Array(totalSamples);

  // Initialize to neutral
  gainCurve.fill(1.0);
  brightnessCurve.fill(0.0);
  widthCurve.fill(1.0);

  // If the track is too flat dynamically, apply minimal automation
  if (arc.overallArc === 'flat' || arc.dynamicRange < 0.1) {
    return { gainCurve, brightnessCurve, widthCurve };
  }

  // Apply section-based automation
  for (const section of arc.sections) {
    const start = section.startSample;
    const end = Math.min(section.endSample, totalSamples);

    for (let i = start; i < end; i++) {
      if (section.isPeak) {
        // Peaks: slight volume boost, brighter, wider
        gainCurve[i] = 1.08;
        brightnessCurve[i] = 0.4;
        widthCurve[i] = 1.25;
      } else if (section.isQuiet) {
        // Quiet/verse: pull back slightly, darker, narrower (intimate)
        gainCurve[i] = 0.92;
        brightnessCurve[i] = -0.25;
        widthCurve[i] = 0.85;
      } else if (section.isClimb) {
        // Building: gradually brighter and wider
        const progress = (i - start) / (end - start);
        gainCurve[i] = 1.0 + progress * 0.05;
        brightnessCurve[i] = progress * 0.3;
        widthCurve[i] = 1.0 + progress * 0.15;
      } else if (section.isDrop) {
        // After a peak drop: brief volume dip for contrast
        const progress = (i - start) / (end - start);
        gainCurve[i] = 0.95 + progress * 0.05;
        brightnessCurve[i] = -0.15 * (1 - progress);
        widthCurve[i] = 0.9 + progress * 0.1;
      }
    }
  }

  // Smooth all curves to prevent clicks (50ms smoothing window)
  const smoothSamples = Math.floor(sampleRate * 0.05);
  smoothCurve(gainCurve, smoothSamples);
  smoothCurve(brightnessCurve, smoothSamples);
  smoothCurve(widthCurve, smoothSamples);

  return { gainCurve, brightnessCurve, widthCurve };
}

function smoothCurve(data: Float32Array, windowSize: number): void {
  if (windowSize < 2) return;
  const temp = new Float32Array(data.length);
  let sum = 0;
  const halfWin = Math.floor(windowSize / 2);

  // Initialize running sum
  for (let i = 0; i < Math.min(halfWin, data.length); i++) {
    sum += data[i];
  }

  for (let i = 0; i < data.length; i++) {
    const addIdx = i + halfWin;
    const removeIdx = i - halfWin - 1;
    if (addIdx < data.length) sum += data[addIdx];
    if (removeIdx >= 0) sum -= data[removeIdx];
    const count = Math.min(addIdx + 1, data.length) - Math.max(removeIdx + 1, 0);
    temp[i] = sum / count;
  }

  data.set(temp);
}

// ─── Apply Arc to Audio Buffer ──────────────────────────────────────
// Modifies the buffer in-place with the journey automation

export async function applyDynamicArc(
  buffer: AudioBuffer,
  onProgress?: (progress: number, message: string) => void
): Promise<{ buffer: AudioBuffer; arc: ArcAnalysis }> {
  const sr = buffer.sampleRate;
  const totalSamples = buffer.length;
  const numChannels = buffer.numberOfChannels;

  onProgress?.(10, 'Analyzing track energy contour...');
  const energyContour = analyzeEnergyContour(buffer, 2.0);

  await new Promise((r) => setTimeout(r, 0));
  onProgress?.(25, 'Detecting song sections...');
  const sections = detectSections(energyContour, totalSamples, sr, 2.0);

  onProgress?.(35, 'Classifying musical arc...');
  const arc = classifyArc(sections);

  onProgress?.(45, 'Generating journey automation...');
  const automation = generateAutomation(arc, totalSamples, sr);

  await new Promise((r) => setTimeout(r, 0));
  onProgress?.(55, 'Applying dynamic automation...');

  // Create output buffer
  const ctx = new OfflineAudioContext(numChannels, totalSamples, sr);
  const outBuffer = ctx.createBuffer(numChannels, totalSamples, sr);

  for (let ch = 0; ch < numChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const output = new Float32Array(totalSamples);

    for (let i = 0; i < totalSamples; i++) {
      let sample = input[i];

      // Apply gain curve
      sample *= automation.gainCurve[i];

      // Apply brightness via simple one-pole high-shelf approximation
      // Positive brightness = boost highs, negative = cut highs
      if (i > 0) {
        const brightness = automation.brightnessCurve[i];
        const highContent = sample - input[i - 1];
        sample += highContent * brightness * 0.3;
      }

      output[i] = sample;
    }

    outBuffer.copyToChannel(new Float32Array(output), ch);

    if (ch === 0) {
      onProgress?.(70, 'Processing stereo width automation...');
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // Apply stereo width automation (only for stereo)
  if (numChannels >= 2) {
    const L = outBuffer.getChannelData(0);
    const R = outBuffer.getChannelData(1);
    const newL = new Float32Array(totalSamples);
    const newR = new Float32Array(totalSamples);

    for (let i = 0; i < totalSamples; i++) {
      const mid = (L[i] + R[i]) * 0.5;
      const side = (L[i] - R[i]) * 0.5;
      const width = automation.widthCurve[i];
      newL[i] = mid + side * width;
      newR[i] = mid - side * width;
    }

    outBuffer.copyToChannel(new Float32Array(newL), 0);
    outBuffer.copyToChannel(new Float32Array(newR), 1);
  }

  onProgress?.(90, 'Finalizing dynamic arc...');
  await new Promise((r) => setTimeout(r, 0));

  onProgress?.(100, 'Journey automation complete!');
  return { buffer: outBuffer, arc };
}
