/**
 * True LUFS / True Peak metering AudioWorklet processor
 * Implements ITU-R BS.1770-4 K-weighting and gated loudness
 * Also provides true peak via 4x oversampling, phase correlation, stereo balance
 */
class MeteringProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // K-weighting filter states (2 biquads in series)
    // Stage 1: High shelf (+4dB at high frequencies)
    this.hs = { x1L: 0, x2L: 0, y1L: 0, y2L: 0, x1R: 0, x2R: 0, y1R: 0, y2R: 0 };
    // Stage 2: High-pass (rumble filter)
    this.hp = { x1L: 0, x2L: 0, y1L: 0, y2L: 0, x1R: 0, x2R: 0, y1R: 0, y2R: 0 };

    // Pre-compute K-weighting coefficients for 48kHz (will recalc if different)
    this.coeffsComputed = false;
    this.hsB = [0, 0, 0];
    this.hsA = [0, 0];
    this.hpB = [0, 0, 0];
    this.hpA = [0, 0];

    // Momentary loudness (400ms window)
    this.momentaryWindowSize = 0;
    this.momentaryBuffer = null;
    this.momentaryIndex = 0;
    this.momentarySum = 0;

    // Short-term loudness (3s window)
    this.shortTermWindowSize = 0;
    this.shortTermBuffer = null;
    this.shortTermIndex = 0;
    this.shortTermSum = 0;

    // Integrated loudness — BS.1770-4 gated blocks
    //   window = 400 ms, hop = 100 ms (75% overlap)
    //   store each block's linear mean-square (z_i)
    this.gatedBlocks = [];
    this.blockWindowSize = 0;   // 400 ms in samples
    this.blockHopSize = 0;      // 100 ms in samples
    this.blockMSBuffer = null;  // circular buffer of per-sample mean-square values
    this.blockWritePos = 0;
    this.blockFilled = 0;       // samples accumulated since last emit
    this.blockRunningSum = 0;   // running sum of mean-square over window
    // Message port: allow host to reset integrated history on new program
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'resetIntegrated') {
        this.gatedBlocks.length = 0;
        this.blockFilled = 0;
        this.blockRunningSum = 0;
        if (this.blockMSBuffer) this.blockMSBuffer.fill(0);
        this.blockWritePos = 0;
      }
    };

    // True peak (4x oversampled)
    this.prevSamplesL = [0, 0, 0, 0];
    this.prevSamplesR = [0, 0, 0, 0];
    this.truePeakL = 0;
    this.truePeakR = 0;

    // Phase correlation (400 ms window — industry standard)
    this.corrSumLR = 0;
    this.corrSumLL = 0;
    this.corrSumRR = 0;
    this.corrWindowSize = 0;
    this.corrBufL = null;
    this.corrBufR = null;
    this.corrIndex = 0;

    // Peak hold
    this.peakHoldL = 0;
    this.peakHoldR = 0;
    this.peakHoldDecay = 0;

    // RMS
    this.rmsWindowSamples = 0;
    this.rmsBufL = null;
    this.rmsBufR = null;
    this.rmsIndex = 0;
    this.rmsSumL = 0;
    this.rmsSumR = 0;

    // Report interval
    this.reportCounter = 0;
    this.reportInterval = 2048; // ~42ms at 48kHz
  }

  computeCoefficients(sr) {
    if (this.coeffsComputed) return;
    this.coeffsComputed = true;

    // BS.1770 K-weighting Stage 1: High shelf
    // Pre-filter coefficients (peaking at high frequencies)
    const f0hs = 1681.974450955533;
    const G = 3.999843853973347;
    const Q_hs = 0.7071752369554196;
    const Khs = Math.tan(Math.PI * f0hs / sr);
    const Vh = Math.pow(10, G / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const a0hs = 1 + Khs / Q_hs + Khs * Khs;
    this.hsB[0] = (1 + Vb * Khs / Q_hs + Khs * Khs) / a0hs;
    this.hsB[1] = 2 * (Khs * Khs - 1) / a0hs;
    this.hsB[2] = (1 - Vb * Khs / Q_hs + Khs * Khs) / a0hs;
    this.hsA[0] = 2 * (Khs * Khs - 1) / a0hs;
    this.hsA[1] = (1 - Khs / Q_hs + Khs * Khs) / a0hs;

    // Stage 2: High-pass (revised low-frequency)
    const f0hp = 38.13547087602444;
    const Q_hp = 0.5003270373238773;
    const Khp = Math.tan(Math.PI * f0hp / sr);
    const a0hp = 1 + Khp / Q_hp + Khp * Khp;
    this.hpB[0] = 1 / a0hp;
    this.hpB[1] = -2 / a0hp;
    this.hpB[2] = 1 / a0hp;
    this.hpA[0] = 2 * (Khp * Khp - 1) / a0hp;
    this.hpA[1] = (1 - Khp / Q_hp + Khp * Khp) / a0hp;

    // Window sizes
    this.momentaryWindowSize = Math.round(sr * 0.4); // 400ms
    this.momentaryBuffer = new Float32Array(this.momentaryWindowSize);
    this.shortTermWindowSize = Math.round(sr * 3); // 3s
    this.shortTermBuffer = new Float32Array(this.shortTermWindowSize);

    // Gated block: 400 ms window, 100 ms hop (BS.1770-4 §5.2 — 75% overlap)
    this.blockWindowSize = Math.round(sr * 0.4);
    this.blockHopSize = Math.round(sr * 0.1);
    this.blockMSBuffer = new Float32Array(this.blockWindowSize);

    // Phase correlation window (400 ms — industry-standard for stability)
    this.corrWindowSize = Math.round(sr * 0.4);
    this.corrBufL = new Float32Array(this.corrWindowSize);
    this.corrBufR = new Float32Array(this.corrWindowSize);

    // RMS window (300ms)
    this.rmsWindowSamples = Math.round(sr * 0.3);
    this.rmsBufL = new Float32Array(this.rmsWindowSamples);
    this.rmsBufR = new Float32Array(this.rmsWindowSamples);

    // Peak hold decay
    this.peakHoldDecay = Math.exp(-1 / (sr * 1.7)); // 1.7s decay
  }

  biquadProcess(x, state, b, a, ch) {
    const x1 = state[`x1${ch}`];
    const x2 = state[`x2${ch}`];
    const y1 = state[`y1${ch}`];
    const y2 = state[`y2${ch}`];

    let y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    // Denormal guard — prevents CPU spikes on sustained silence (M15)
    if (y > -1e-30 && y < 1e-30) y = 0;

    state[`x2${ch}`] = x1;
    state[`x1${ch}`] = x;
    state[`y2${ch}`] = y1;
    state[`y1${ch}`] = y;

    return y;
  }

  // 4x oversampled true peak detection using Catmull-Rom interpolation
  truePeakDetect(current, prevSamples) {
    let peak = Math.abs(current);

    const s0 = prevSamples[0];
    const s1 = prevSamples[1];
    const s2 = prevSamples[2];
    const s3 = current;

    // Check 3 interpolated points between s2 and s3
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const t2 = t * t;
      const t3 = t2 * t;
      const interp = 0.5 * (
        (2 * s2) +
        (-s1 + s3) * t +
        (2 * s1 - 5 * s2 + 4 * s3 - s0) * t2 +  // Fixed: use s0 not prevSamples typo
        (-s1 + 3 * s2 - 3 * s3 + s0) * t3
      );
      const abs = Math.abs(interp);
      if (abs > peak) peak = abs;
    }

    // Shift prev samples
    prevSamples[0] = prevSamples[1];
    prevSamples[1] = prevSamples[2];
    prevSamples[2] = prevSamples[3];
    prevSamples[3] = current;

    return peak;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    this.computeCoefficients(sampleRate);

    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const len = inL.length;

    let frameTruePeakL = 0;
    let frameTruePeakR = 0;

    for (let i = 0; i < len; i++) {
      // Pass through
      outL[i] = inL[i];
      outR[i] = inR[i];

      // K-weighting
      const ksL = this.biquadProcess(inL[i], this.hs, this.hsB, this.hsA, 'L');
      const kL = this.biquadProcess(ksL, this.hp, this.hpB, this.hpA, 'L');
      const ksR = this.biquadProcess(inR[i], this.hs, this.hsB, this.hsA, 'R');
      const kR = this.biquadProcess(ksR, this.hp, this.hpB, this.hpA, 'R');

      // Mean square for LUFS
      const ms = (kL * kL + kR * kR) / 2;

      // Momentary buffer
      if (this.momentaryBuffer) {
        this.momentarySum -= this.momentaryBuffer[this.momentaryIndex];
        this.momentaryBuffer[this.momentaryIndex] = ms;
        this.momentarySum += ms;
        this.momentaryIndex = (this.momentaryIndex + 1) % this.momentaryWindowSize;
      }

      // Short-term buffer
      if (this.shortTermBuffer) {
        this.shortTermSum -= this.shortTermBuffer[this.shortTermIndex];
        this.shortTermBuffer[this.shortTermIndex] = ms;
        this.shortTermSum += ms;
        this.shortTermIndex = (this.shortTermIndex + 1) % this.shortTermWindowSize;
      }

      // Gated loudness accumulation — BS.1770-4 compliant (C1/C2/C3)
      //   Circular running sum of per-sample mean-square over 400 ms window.
      //   Emit one block every 100 ms once the window is filled → 75% overlap.
      //   Store linear mean-square z_i (not LUFS) for correct gated averaging.
      if (this.blockMSBuffer) {
        const old = this.blockMSBuffer[this.blockWritePos];
        this.blockMSBuffer[this.blockWritePos] = ms;
        this.blockRunningSum += ms - old;
        this.blockWritePos = (this.blockWritePos + 1) % this.blockWindowSize;
        this.blockFilled++;
        // Only emit once window is fully populated (first 400 ms is warm-up)
        if (this.blockFilled >= this.blockWindowSize &&
            ((this.blockFilled - this.blockWindowSize) % this.blockHopSize === 0)) {
          const blockMS = this.blockRunningSum / this.blockWindowSize;
          if (blockMS > 0) this.gatedBlocks.push(blockMS);
          // No history cap — integrated loudness must span the entire program.
          // Caller can issue {type:'resetIntegrated'} when starting a new track.
        }
      }

      // True peak detection
      const tpL = this.truePeakDetect(inL[i], this.prevSamplesL);
      const tpR = this.truePeakDetect(inR[i], this.prevSamplesR);
      if (tpL > frameTruePeakL) frameTruePeakL = tpL;
      if (tpR > frameTruePeakR) frameTruePeakR = tpR;

      // Peak hold with decay
      if (tpL > this.peakHoldL) this.peakHoldL = tpL;
      else this.peakHoldL *= this.peakHoldDecay;
      if (tpR > this.peakHoldR) this.peakHoldR = tpR;
      else this.peakHoldR *= this.peakHoldDecay;

      // RMS
      if (this.rmsBufL) {
        this.rmsSumL -= this.rmsBufL[this.rmsIndex] * this.rmsBufL[this.rmsIndex];
        this.rmsSumR -= this.rmsBufR[this.rmsIndex] * this.rmsBufR[this.rmsIndex];
        this.rmsBufL[this.rmsIndex] = inL[i];
        this.rmsBufR[this.rmsIndex] = inR[i];
        this.rmsSumL += inL[i] * inL[i];
        this.rmsSumR += inR[i] * inR[i];
        this.rmsIndex = (this.rmsIndex + 1) % this.rmsWindowSamples;
      }

      // Phase correlation
      if (this.corrBufL) {
        const oldL = this.corrBufL[this.corrIndex];
        const oldR = this.corrBufR[this.corrIndex];
        this.corrSumLR -= oldL * oldR;
        this.corrSumLL -= oldL * oldL;
        this.corrSumRR -= oldR * oldR;
        this.corrBufL[this.corrIndex] = inL[i];
        this.corrBufR[this.corrIndex] = inR[i];
        this.corrSumLR += inL[i] * inR[i];
        this.corrSumLL += inL[i] * inL[i];
        this.corrSumRR += inR[i] * inR[i];
        this.corrIndex = (this.corrIndex + 1) % this.corrWindowSize;
      }
    }

    // Track true peak
    if (frameTruePeakL > this.truePeakL) this.truePeakL = frameTruePeakL;
    if (frameTruePeakR > this.truePeakR) this.truePeakR = frameTruePeakR;

    // Report
    this.reportCounter += len;
    if (this.reportCounter >= this.reportInterval) {
      const momentaryLoudness = this.momentarySum > 0 && this.momentaryWindowSize > 0
        ? -0.691 + 10 * Math.log10(this.momentarySum / this.momentaryWindowSize)
        : -Infinity;

      const shortTermLoudness = this.shortTermSum > 0 && this.shortTermWindowSize > 0
        ? -0.691 + 10 * Math.log10(this.shortTermSum / this.shortTermWindowSize)
        : -Infinity;

      // Integrated loudness with dual gating — BS.1770-4 §5.3
      //   Absolute gate: exclude blocks below -70 LUFS
      //   Relative gate: exclude blocks >= 10 LU below absolute-gated mean
      //   Both gates operate on linear mean-square, averaged in linear domain.
      let integratedLoudness = -Infinity;
      if (this.gatedBlocks.length > 0) {
        // -70 LUFS ↔ mean-square threshold (10^((-70+0.691)/10))
        const absThreshMS = Math.pow(10, (-70 + 0.691) / 10);
        let absSum = 0, absCount = 0;
        for (let b = 0; b < this.gatedBlocks.length; b++) {
          if (this.gatedBlocks[b] > absThreshMS) {
            absSum += this.gatedBlocks[b];
            absCount++;
          }
        }
        if (absCount > 0) {
          const absAvgMS = absSum / absCount;
          // Relative gate: -10 LU below absolute-gated mean → threshold MS = absAvgMS * 10^(-1)
          const relThreshMS = absAvgMS * 0.1;
          let relSum = 0, relCount = 0;
          for (let b = 0; b < this.gatedBlocks.length; b++) {
            const v = this.gatedBlocks[b];
            if (v > absThreshMS && v > relThreshMS) {
              relSum += v;
              relCount++;
            }
          }
          if (relCount > 0) {
            integratedLoudness = -0.691 + 10 * Math.log10(relSum / relCount);
          }
        }
      }

      // Phase correlation
      const denom = Math.sqrt(Math.max(this.corrSumLL, 1e-20) * Math.max(this.corrSumRR, 1e-20));
      const phaseCorrelation = denom > 0 ? this.corrSumLR / denom : 0;

      // RMS
      const rmsL = this.rmsWindowSamples > 0 ? Math.sqrt(Math.max(this.rmsSumL, 0) / this.rmsWindowSamples) : 0;
      const rmsR = this.rmsWindowSamples > 0 ? Math.sqrt(Math.max(this.rmsSumR, 0) / this.rmsWindowSamples) : 0;

      this.port.postMessage({
        type: 'meters',
        momentaryLUFS: momentaryLoudness,
        shortTermLUFS: shortTermLoudness,
        integratedLUFS: integratedLoudness,
        truePeakL: this.truePeakL > 0 ? 20 * Math.log10(this.truePeakL) : -Infinity,
        truePeakR: this.truePeakR > 0 ? 20 * Math.log10(this.truePeakR) : -Infinity,
        peakHoldL: this.peakHoldL > 0 ? 20 * Math.log10(this.peakHoldL) : -Infinity,
        peakHoldR: this.peakHoldR > 0 ? 20 * Math.log10(this.peakHoldR) : -Infinity,
        rmsL: rmsL > 0 ? 20 * Math.log10(rmsL) : -Infinity,
        rmsR: rmsR > 0 ? 20 * Math.log10(rmsR) : -Infinity,
        phaseCorrelation,
        clipL: this.truePeakL >= 1.0,
        clipR: this.truePeakR >= 1.0,
      });

      // Reset true peak per report (keep peak hold for display)
      this.truePeakL = 0;
      this.truePeakR = 0;
      this.reportCounter = 0;
    }

    return true;
  }
}

registerProcessor('metering-processor', MeteringProcessor);
