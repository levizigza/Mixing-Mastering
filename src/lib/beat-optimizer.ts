// ─── Beat Optimizer ───────────────────────────────────────────────
// Pure DSP beat enhancement: detects tempo, identifies drum elements
// (kick/snare/hat), and applies per-element processing to make beats
// hit harder, punchier, crisper, or warmer.
//
// Fully open source, zero external dependencies, client-side only.

export interface BeatAnalysis {
  bpm: number;
  confidence: number;
  kickCount: number;
  snareCount: number;
  hatCount: number;
  totalHits: number;
  averageVelocity: number;
  grooveTightness: number; // 0–1, how consistent the timing is
}

export interface BeatOptimizeSettings {
  kickPunch: number;       // 0–100, low-end transient emphasis
  kickSub: number;         // 0–100, sub-bass boost on kicks
  snareCrack: number;      // 0–100, mid-high transient snap
  snareBody: number;       // 0–100, snare body/weight
  hatCrisp: number;        // 0–100, hi-hat presence/clarity
  hatSoft: number;         // 0–100, hi-hat de-harshness
  overallPunch: number;    // 0–100, parallel compression amount
  transientAttack: number; // 0–100, global transient sharpening
  groove: number;          // 0–100, groove quantize tightness (0=loose, 100=locked)
}

export interface BeatOptimizeResult {
  buffer: AudioBuffer;
  analysis: BeatAnalysis;
}

export const defaultBeatSettings: BeatOptimizeSettings = {
  kickPunch: 50,
  kickSub: 40,
  snareCrack: 50,
  snareBody: 40,
  hatCrisp: 45,
  hatSoft: 20,
  overallPunch: 50,
  transientAttack: 50,
  groove: 0,
};

export const beatPresets: { name: string; description: string; settings: BeatOptimizeSettings }[] = [
  {
    name: 'Punchy',
    description: 'Hard-hitting kicks and snappy snares',
    settings: { kickPunch: 75, kickSub: 50, snareCrack: 70, snareBody: 45, hatCrisp: 40, hatSoft: 10, overallPunch: 65, transientAttack: 70, groove: 0 },
  },
  {
    name: 'Crisp',
    description: 'Clean and detailed with airy highs',
    settings: { kickPunch: 40, kickSub: 30, snareCrack: 60, snareBody: 30, hatCrisp: 75, hatSoft: 0, overallPunch: 40, transientAttack: 60, groove: 0 },
  },
  {
    name: 'Warm',
    description: 'Rounded low-end with smooth transients',
    settings: { kickPunch: 35, kickSub: 70, snareCrack: 25, snareBody: 65, hatCrisp: 20, hatSoft: 60, overallPunch: 55, transientAttack: 25, groove: 0 },
  },
  {
    name: 'Hard',
    description: 'Aggressive with maximized transients',
    settings: { kickPunch: 90, kickSub: 60, snareCrack: 85, snareBody: 50, hatCrisp: 55, hatSoft: 0, overallPunch: 80, transientAttack: 90, groove: 0 },
  },
  {
    name: 'Lo-Fi',
    description: 'Soft, dusty feel with loose groove',
    settings: { kickPunch: 30, kickSub: 55, snareCrack: 20, snareBody: 50, hatCrisp: 15, hatSoft: 70, overallPunch: 30, transientAttack: 15, groove: 0 },
  },
  {
    name: 'Tight',
    description: 'Quantized and precise with balanced tone',
    settings: { kickPunch: 55, kickSub: 45, snareCrack: 55, snareBody: 45, hatCrisp: 50, hatSoft: 15, overallPunch: 50, transientAttack: 55, groove: 85 },
  },
  {
    name: 'Trap',
    description: 'Booming 808 sub with sharp hats',
    settings: { kickPunch: 60, kickSub: 90, snareCrack: 65, snareBody: 30, hatCrisp: 80, hatSoft: 0, overallPunch: 55, transientAttack: 65, groove: 0 },
  },
  {
    name: 'Boom Bap',
    description: 'Classic hip-hop punch with groove',
    settings: { kickPunch: 70, kickSub: 55, snareCrack: 75, snareBody: 60, hatCrisp: 35, hatSoft: 30, overallPunch: 60, transientAttack: 50, groove: 30 },
  },
];

// ─── Tempo Detection via Autocorrelation ─────────────────────────

function detectTempo(buffer: AudioBuffer): { bpm: number; confidence: number } {
  const sr = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const len = Math.min(data.length, sr * 15); // Analyze up to 15 seconds

  // Compute onset strength envelope
  const hopSize = Math.floor(sr * 0.01); // 10ms hops
  const envLen = Math.floor(len / hopSize);
  const envelope = new Float32Array(envLen);

  let prevEnergy = 0;
  for (let i = 0; i < envLen; i++) {
    const start = i * hopSize;
    const end = Math.min(start + hopSize, len);
    let energy = 0;
    for (let j = start; j < end; j++) energy += data[j] * data[j];
    energy /= (end - start);
    // Half-wave rectified difference (onset strength)
    envelope[i] = Math.max(0, energy - prevEnergy);
    prevEnergy = energy;
  }

  // Autocorrelation on envelope to find periodicity
  const minBPM = 60;
  const maxBPM = 200;
  const minLag = Math.floor((60 / maxBPM) / 0.01); // Convert BPM to lag in hops
  const maxLag = Math.floor((60 / minBPM) / 0.01);

  let bestLag = minLag;
  let bestCorr = -Infinity;
  const corrValues = new Float32Array(maxLag - minLag + 1);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let count = 0;
    for (let i = 0; i < envLen - lag; i++) {
      corr += envelope[i] * envelope[i + lag];
      count++;
    }
    corr /= (count || 1);
    corrValues[lag - minLag] = corr;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  const bpm = 60 / (bestLag * 0.01);

  // Confidence: ratio of best peak to mean
  let mean = 0;
  for (let i = 0; i < corrValues.length; i++) mean += corrValues[i];
  mean /= corrValues.length || 1;
  const confidence = mean > 0 ? Math.min(1, bestCorr / (mean * 3)) : 0.5;

  return { bpm: Math.round(bpm * 10) / 10, confidence };
}

// ─── Hit Detection (Kick / Snare / Hat classification) ──────────

interface DetectedHit {
  position: number; // sample index
  type: 'kick' | 'snare' | 'hat';
  velocity: number; // 0–1
}

function detectHits(buffer: AudioBuffer): DetectedHit[] {
  const sr = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const len = data.length;
  const hits: DetectedHit[] = [];

  // Envelope follower
  const hopSize = Math.floor(sr * 0.005); // 5ms
  const attackCoeff = 1 - Math.exp(-1 / (sr * 0.001));
  const releaseCoeff = 1 - Math.exp(-1 / (sr * 0.02));

  let env = 0;
  const envelope = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const abs = Math.abs(data[i]);
    env += (abs > env ? attackCoeff : releaseCoeff) * (abs - env);
    envelope[i] = env;
  }

  // Onset detection
  const minGap = Math.floor(sr * 0.05); // Minimum 50ms between hits
  let lastOnset = -minGap;

  for (let i = hopSize; i < len - hopSize; i += hopSize) {
    const delta = envelope[i] - envelope[i - hopSize];
    if (delta > 0.01 && envelope[i] > 0.005 && (i - lastOnset) > minGap) {
      lastOnset = i;
      const velocity = Math.min(1, envelope[i] * 5);

      // Classify by frequency content around the hit
      const windowSize = Math.min(Math.floor(sr * 0.02), len - i); // 20ms window
      let lowEnergy = 0;
      let midEnergy = 0;
      let highEnergy = 0;

      for (let j = 1; j < windowSize; j++) {
        const diff = data[i + j] - data[i + j - 1];
        const smooth = (data[i + j] + (j > 1 ? data[i + j - 1] : 0) + (j > 2 ? data[i + j - 2] : 0)) / 3;
        lowEnergy += smooth * smooth;
        highEnergy += diff * diff;
        const midDiff = j > 2 ? data[i + j] - data[i + j - 2] : 0;
        midEnergy += midDiff * midDiff;
      }

      const total = lowEnergy + midEnergy + highEnergy || 1;
      const lowRatio = lowEnergy / total;
      const highRatio = highEnergy / total;

      let type: 'kick' | 'snare' | 'hat';
      if (lowRatio > 0.5) {
        type = 'kick';
      } else if (highRatio > 0.45) {
        type = 'hat';
      } else {
        type = 'snare';
      }

      hits.push({ position: i, type, velocity });
    }
  }

  return hits;
}

// ─── Groove Tightness Measurement ────────────────────────────────

function measureGrooveTightness(hits: DetectedHit[], bpm: number, sampleRate: number): number {
  if (hits.length < 4 || bpm <= 0) return 1;

  const beatInterval = (60 / bpm) * sampleRate;
  const sixteenthInterval = beatInterval / 4;

  let totalDeviation = 0;
  let count = 0;

  for (const hit of hits) {
    // Find nearest grid position (16th note)
    const gridPos = Math.round(hit.position / sixteenthInterval) * sixteenthInterval;
    const deviation = Math.abs(hit.position - gridPos) / sixteenthInterval;
    totalDeviation += deviation;
    count++;
  }

  const avgDeviation = count > 0 ? totalDeviation / count : 0;
  return Math.max(0, Math.min(1, 1 - avgDeviation * 4));
}

// ─── Beat Analysis ──────────────────────────────────────────────

export function analyzeBeat(buffer: AudioBuffer): BeatAnalysis {
  const { bpm, confidence } = detectTempo(buffer);
  const hits = detectHits(buffer);

  const kickCount = hits.filter((h) => h.type === 'kick').length;
  const snareCount = hits.filter((h) => h.type === 'snare').length;
  const hatCount = hits.filter((h) => h.type === 'hat').length;
  const averageVelocity = hits.length > 0
    ? hits.reduce((s, h) => s + h.velocity, 0) / hits.length
    : 0;
  const grooveTightness = measureGrooveTightness(hits, bpm, buffer.sampleRate);

  return {
    bpm,
    confidence,
    kickCount,
    snareCount,
    hatCount,
    totalHits: hits.length,
    averageVelocity,
    grooveTightness,
  };
}

// ─── Beat Enhancement DSP ───────────────────────────────────────

async function applyFilter(
  buffer: AudioBuffer,
  type: BiquadFilterType,
  frequency: number,
  Q?: number,
  gain?: number
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
  if (gain !== undefined) filter.gain.value = gain;
  source.connect(filter);
  filter.connect(ctx.destination);
  source.start();
  return ctx.startRendering();
}

function createBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const ctx = new OfflineAudioContext(channels.length, channels[0].length, sampleRate);
  const buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
  for (let ch = 0; ch < channels.length; ch++) buf.copyToChannel(new Float32Array(channels[ch]), ch);
  return buf;
}

// Transient shaping: emphasize the attack portion of each hit
function shapeTransients(data: Float32Array, sampleRate: number, amount: number): Float32Array {
  if (amount <= 0) return data;
  const result = new Float32Array(data.length);
  const attackWindow = Math.floor(sampleRate * 0.01); // 10ms lookback
  const maxBoost = 1 + amount * 1.2; // Max 2.2x boost (gentle)

  // Envelope follower for transient detection
  let env = 0;
  const attCoeff = 1 - Math.exp(-1 / (sampleRate * 0.001));
  const relCoeff = 1 - Math.exp(-1 / (sampleRate * 0.06));

  const envelope = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    env += (abs > env ? attCoeff : relCoeff) * (abs - env);
    envelope[i] = env;
  }

  // Compute a smooth gain curve based on rising edges
  const gainCurve = new Float32Array(data.length);
  gainCurve.fill(1);

  for (let i = attackWindow; i < data.length; i++) {
    const delta = envelope[i] - envelope[i - attackWindow];
    if (delta > 0.005) {
      const boost = 1 + Math.min(delta * amount * 5, maxBoost - 1);
      gainCurve[i] = boost;
    }
  }

  // Smooth the gain curve to avoid clicks (10ms smoothing)
  const smoothCoeff = 1 - Math.exp(-1 / (sampleRate * 0.003));
  let smoothGain = 1;
  for (let i = 0; i < data.length; i++) {
    smoothGain += smoothCoeff * (gainCurve[i] - smoothGain);
    result[i] = data[i] * smoothGain;
  }

  return result;
}

// Soft-clip to prevent overs
function softClip(data: Float32Array, threshold: number = 0.95): Float32Array {
  const result = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    if (Math.abs(x) > threshold) {
      const sign = x > 0 ? 1 : -1;
      const over = Math.abs(x) - threshold;
      result[i] = sign * (threshold + Math.tanh(over * 3) * (1 - threshold));
    } else {
      result[i] = x;
    }
  }
  return result;
}

// Parallel compression simulation
function parallelCompress(data: Float32Array, sampleRate: number, amount: number): Float32Array {
  if (amount <= 0) return data;
  const result = new Float32Array(data.length);
  const mix = amount * 0.5; // Conservative mix (max 50% wet)

  // Compressor with smooth gain to avoid clicks
  let env = 0;
  let smoothedGain = 1;
  const attCoeff = 1 - Math.exp(-1 / (sampleRate * 0.005));
  const relCoeff = 1 - Math.exp(-1 / (sampleRate * 0.15));
  const gainSmooth = 1 - Math.exp(-1 / (sampleRate * 0.005)); // 5ms gain smoothing
  const threshold = 0.12;
  const ratio = 3;
  const maxGain = 3; // Limit boost to 3x

  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    env += (abs > env ? attCoeff : relCoeff) * (abs - env);

    let targetGain = 1;
    if (env < threshold && env > 0.002) {
      const dB = 20 * Math.log10(env / threshold);
      const compressed = dB / ratio;
      targetGain = Math.min(maxGain, Math.pow(10, (compressed - dB) / 20));
    }

    // Smooth gain changes to prevent clicks
    smoothedGain += gainSmooth * (targetGain - smoothedGain);

    const compressed = data[i] * smoothedGain;
    result[i] = data[i] * (1 - mix) + compressed * mix;
  }

  return result;
}

// ─── Main Optimize Function ─────────────────────────────────────

export async function optimizeBeat(
  buffer: AudioBuffer,
  settings: BeatOptimizeSettings,
  onProgress?: (progress: number, message: string) => void
): Promise<BeatOptimizeResult> {
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const numCh = buffer.numberOfChannels;

  onProgress?.(5, 'Analyzing beat...');
  await new Promise((r) => setTimeout(r, 0));
  const analysis = analyzeBeat(buffer);

  onProgress?.(15, 'Processing kick frequencies...');
  await new Promise((r) => setTimeout(r, 0));

  // Kick enhancement: low-end EQ boost + sub boost
  let processed = buffer;
  if (settings.kickPunch > 0 || settings.kickSub > 0) {
    const kickBoost = (settings.kickPunch / 100) * 4; // Up to +4 dB
    const subBoost = (settings.kickSub / 100) * 5; // Up to +5 dB
    if (kickBoost > 0) {
      processed = await applyFilter(processed, 'peaking', 80, 1.5, kickBoost);
    }
    if (subBoost > 0) {
      processed = await applyFilter(processed, 'peaking', 45, 1.0, subBoost);
    }
  }

  onProgress?.(30, 'Enhancing snare...');
  await new Promise((r) => setTimeout(r, 0));

  // Snare enhancement: crack (2–5 kHz) + body (200–400 Hz)
  if (settings.snareCrack > 0) {
    const crackBoost = (settings.snareCrack / 100) * 4;
    processed = await applyFilter(processed, 'peaking', 3000, 1.5, crackBoost);
  }
  if (settings.snareBody > 0) {
    const bodyBoost = (settings.snareBody / 100) * 3;
    processed = await applyFilter(processed, 'peaking', 280, 1.2, bodyBoost);
  }

  onProgress?.(45, 'Shaping hi-hats...');
  await new Promise((r) => setTimeout(r, 0));

  // Hi-hat: crisp (8–12 kHz boost) or soft (high shelf cut)
  if (settings.hatCrisp > 0) {
    const crispBoost = (settings.hatCrisp / 100) * 3.5;
    processed = await applyFilter(processed, 'peaking', 10000, 1.0, crispBoost);
  }
  if (settings.hatSoft > 0) {
    const softCut = -(settings.hatSoft / 100) * 4;
    processed = await applyFilter(processed, 'highshelf', 9000, 0.7, softCut);
  }

  onProgress?.(60, 'Shaping transients...');
  await new Promise((r) => setTimeout(r, 0));

  // Transient shaping — per-channel
  const transientAmount = settings.transientAttack / 100;
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numCh; ch++) {
    let chData: Float32Array = new Float32Array(processed.getChannelData(ch));
    if (transientAmount > 0) {
      chData = shapeTransients(chData, sr, transientAmount);
    }
    channels.push(chData);
  }

  onProgress?.(75, 'Applying parallel compression...');
  await new Promise((r) => setTimeout(r, 0));

  // Parallel compression
  const punchAmount = settings.overallPunch / 100;
  if (punchAmount > 0) {
    for (let ch = 0; ch < channels.length; ch++) {
      channels[ch] = parallelCompress(channels[ch], sr, punchAmount * 0.6);
    }
  }

  onProgress?.(85, 'Finalizing...');

  // Soft-clip to prevent clipping
  for (let ch = 0; ch < channels.length; ch++) {
    channels[ch] = softClip(channels[ch], 0.96);
  }

  // Groove quantization (if enabled)
  // This micro-shifts transients toward the grid — only significant at high values
  if (settings.groove > 20 && analysis.bpm > 0) {
    onProgress?.(90, 'Tightening groove...');
    const beatInterval = (60 / analysis.bpm) * sr;
    const sixteenthInterval = beatInterval / 4;
    const strength = (settings.groove - 20) / 80; // Effective 0–1 range above threshold

    // For each channel, find peaks and micro-shift toward grid
    // This is a simplified approach: it applies a subtle time-domain nudge
    for (let ch = 0; ch < channels.length; ch++) {
      const chData = channels[ch];
      const shifted = new Float32Array(chData.length);
      shifted.set(chData);

      // Find transient peaks
      let env = 0;
      const aCoeff = 1 - Math.exp(-1 / (sr * 0.001));
      const rCoeff = 1 - Math.exp(-1 / (sr * 0.02));
      const peakPositions: number[] = [];
      let lastPeak = -sr * 0.05;

      for (let i = 0; i < chData.length; i++) {
        const abs = Math.abs(chData[i]);
        env += (abs > env ? aCoeff : rCoeff) * (abs - env);
        if (i > 0 && env > 0.02 && (i - lastPeak) > sr * 0.04) {
          const prevEnv = Math.abs(chData[Math.max(0, i - Math.floor(sr * 0.005))]);
          if (env > prevEnv * 1.3) {
            peakPositions.push(i);
            lastPeak = i;
          }
        }
      }

      // Nudge peaks toward nearest 16th note grid (conservative, artifact-free)
      for (const pos of peakPositions) {
        const nearestGrid = Math.round(pos / sixteenthInterval) * sixteenthInterval;
        const offset = nearestGrid - pos;
        const nudge = Math.round(offset * strength * 0.3); // Max 30% correction
        if (Math.abs(nudge) > 1 && Math.abs(nudge) < sr * 0.008) { // Max 8ms shift
          const windowHalf = Math.floor(sr * 0.008);
          const srcStart = Math.max(0, pos - windowHalf);
          const srcEnd = Math.min(chData.length - 1, pos + windowHalf);
          const windowLen = srcEnd - srcStart;
          if (windowLen <= 0) continue;

          // First, clear the destination region with a smooth fade-out
          for (let j = srcStart; j < srcEnd; j++) {
            const destJ = j + nudge;
            if (destJ >= 0 && destJ < shifted.length) {
              const t = (j - srcStart) / windowLen;
              // Raised cosine fade envelope
              const envelope = 0.5 * (1 - Math.cos(2 * Math.PI * t));
              shifted[destJ] = chData[j] * envelope + shifted[destJ] * (1 - envelope);
            }
          }
        }
      }

      channels[ch] = shifted;
    }
  }

  onProgress?.(95, 'Smoothing output...');
  await new Promise((r) => setTimeout(r, 0));

  // Final safety: smooth limiter to catch any transient overshoot
  for (let ch = 0; ch < channels.length; ch++) {
    const data = channels[ch];
    const ceiling = 0.95;
    let smoothGain = 1;
    const gainRelease = 1 - Math.exp(-1 / (sr * 0.003)); // 3ms release

    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      let targetGain = 1;
      if (abs > ceiling) {
        targetGain = ceiling / abs;
      }
      if (targetGain < smoothGain) {
        smoothGain = targetGain;
      } else {
        smoothGain += gainRelease * (targetGain - smoothGain);
      }
      data[i] *= smoothGain;
    }
  }

  onProgress?.(98, 'Building output...');

  const resultBuffer = createBuffer(channels, sr);

  onProgress?.(100, 'Beat optimization complete!');

  return { buffer: resultBuffer, analysis };
}

// ─── Auto Beat Station ───────────────────────────────────────────
// LANDR / Sound On Sound style beat prep: pick a style from analysis,
// clear mud, manage low end, punch drums, leave vocal pocket, level.

export interface AutoBeatStationResult extends BeatOptimizeResult {
  presetName: string;
  notes: string[];
}

function spectralBalances(buffer: AudioBuffer): { low: number; mid: number; high: number } {
  const sr = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const len = Math.min(data.length, sr * 12);
  let low = 0, mid = 0, high = 0;
  for (let i = 2; i < len; i++) {
    const s = data[i];
    low += s * s;
    const d1 = data[i] - data[i - 1];
    mid += d1 * d1;
    const d2 = data[i] - data[i - 2];
    high += d2 * d2;
  }
  const t = low + mid + high || 1;
  return { low: low / t, mid: mid / t, high: high / t };
}

/** Choose Trap / Boom Bap / Punchy / Warm / Crisp from tempo + spectrum. */
export function pickBeatPreset(analysis: BeatAnalysis, buffer: AudioBuffer): typeof beatPresets[number] {
  const { bpm } = analysis;
  const bal = spectralBalances(buffer);

  if (bpm >= 130 && bpm <= 165 && bal.low > 0.38) {
    return beatPresets.find((p) => p.name === 'Trap')!;
  }
  if (bpm >= 82 && bpm <= 98) {
    return beatPresets.find((p) => p.name === 'Boom Bap')!;
  }
  if (bal.high > 0.4) {
    return beatPresets.find((p) => p.name === 'Crisp')!;
  }
  if (bal.low > 0.45) {
    return beatPresets.find((p) => p.name === 'Warm')!;
  }
  return beatPresets.find((p) => p.name === 'Punchy')!;
}

/**
 * Full beat station pass: analyze → style preset → drum punch →
 * low-end clarity → vocal pocket → healthy beat level.
 */
export async function autoOptimizeBeat(
  buffer: AudioBuffer,
  onProgress?: (progress: number, message: string) => void
): Promise<AutoBeatStationResult> {
  onProgress?.(4, 'Analyzing instrumental...');
  await new Promise((r) => setTimeout(r, 0));
  const analysis = analyzeBeat(buffer);
  const preset = pickBeatPreset(analysis, buffer);
  const notes: string[] = [
    `Detected ~${Math.round(analysis.bpm)} BPM (${Math.round(analysis.confidence * 100)}% confidence).`,
    `Applied “${preset.name}” beat profile — ${preset.description}.`,
  ];

  // Slightly stronger defaults for station use
  const settings: BeatOptimizeSettings = {
    ...preset.settings,
    overallPunch: Math.min(90, preset.settings.overallPunch + 8),
    transientAttack: Math.min(90, preset.settings.transientAttack + 5),
  };

  onProgress?.(18, `Style: ${preset.name} — optimizing drums...`);
  const core = await optimizeBeat(buffer, settings, (p, m) => {
    onProgress?.(18 + p * 0.55, m);
  });

  let processed = core.buffer;
  const bal = spectralBalances(buffer);

  onProgress?.(78, 'Clearing mud & managing low end...');
  await new Promise((r) => setTimeout(r, 0));

  // LANDR trap/hip-hop: roll competing low mush; keep foundation firm
  processed = await applyFilter(processed, 'highpass', 28, 0.707, 0);
  if (bal.low > 0.42) {
    processed = await applyFilter(processed, 'peaking', 250, 1.4, -2.0);
    notes.push('Tamed low-mid mud so kick/bass stay clearer.');
  } else {
    processed = await applyFilter(processed, 'peaking', 280, 1.3, -1.0);
  }

  // Kick / 808 separation cue: gentle scoop around competing body
  processed = await applyFilter(processed, 'peaking', 90, 1.2, bal.low > 0.4 ? 1.2 : 0.6);

  onProgress?.(88, 'Opening vocal pocket...');
  await new Promise((r) => setTimeout(r, 0));
  // Leave 2–5 kHz for rapper / singer (LANDR mixing hip-hop)
  processed = await applyFilter(processed, 'peaking', 3200, 1.6, -1.8);
  processed = await applyFilter(processed, 'peaking', 5500, 1.8, -1.0);
  notes.push('Carved a 2–5 kHz vocal pocket so the beat is ready for vocals.');

  // Level the beat to healthy instrumental headroom (~−16 RMS, peak ≤ −6)
  onProgress?.(94, 'Levelling beat for vocal tracking...');
  await new Promise((r) => setTimeout(r, 0));
  {
    let peak = 0;
    let sum = 0;
    let count = 0;
    for (let ch = 0; ch < processed.numberOfChannels; ch++) {
      const d = processed.getChannelData(ch);
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
    let gainDb = -16 - rmsDb;
    if (peakDb + gainDb > -6) gainDb = -6 - peakDb;
    gainDb = Math.max(-12, Math.min(12, gainDb));
    if (Math.abs(gainDb) > 0.2) {
      const g = Math.pow(10, gainDb / 20);
      const channels: Float32Array[] = [];
      for (let ch = 0; ch < processed.numberOfChannels; ch++) {
        const src = processed.getChannelData(ch);
        const out = new Float32Array(src.length);
        for (let i = 0; i < src.length; i++) out[i] = Math.tanh(src[i] * g * 1.02) / 1.02;
        channels.push(out);
      }
      processed = createBuffer(channels, processed.sampleRate);
      notes.push(`Beat levelled ${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB for headroom.`);
    }
  }

  onProgress?.(100, 'Beat station complete!');
  return {
    buffer: processed,
    analysis: core.analysis,
    presetName: preset.name,
    notes,
  };
}
