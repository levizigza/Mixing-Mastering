/**
 * Pro-grade true peak limiter AudioWorklet processor
 * Features: 4x oversampled true peak detection, lookahead,
 * intersample peak handling, soft clip, release shaping
 */
class LimiterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'ceiling', defaultValue: -1, minValue: -12, maxValue: 0 },
      { name: 'release', defaultValue: 0.05, minValue: 0.001, maxValue: 1.0 },
      { name: 'lookahead', defaultValue: 0.005, minValue: 0.001, maxValue: 0.01 },
    ];
  }

  constructor() {
    super();
    // Lookahead buffers (sized for max 10 ms at 96 kHz = 960 samples)
    this.maxDelaySamples = 1024;
    this.delayBufL = new Float32Array(this.maxDelaySamples);
    this.delayBufR = new Float32Array(this.maxDelaySamples);
    this.delayIdx = 0;

    // ISP detection history (4 previous samples per channel for 4-point interp)
    this.ispHistL = [0, 0, 0, 0];
    this.ispHistR = [0, 0, 0, 0];

    // Future-peak buffer aligned with lookahead delay — stores per-sample
    // oversampled true-peak values so the envelope can react to the maximum
    // intersample peak inside the lookahead window.
    this.ispPeakBuf = new Float32Array(this.maxDelaySamples);

    this.envelope = 1; // gain reduction factor (1 = no reduction)
    this.peakGR = 0;
    this.grReportCounter = 0;
  }

  // 4x oversampled intersample peak detection via 4-point Catmull-Rom.
  // Returns the maximum |x| across the current sample and 3 interpolated
  // points between previous sample and current sample.
  // Reasonable approximation to the BS.1770-4 Annex 2 FIR (±0.3 dB typical).
  ispPeak(current, hist) {
    const s0 = hist[0], s1 = hist[1], s2 = hist[2], s3 = current;
    let peak = Math.abs(s3);
    // 3 interpolated points between s2 and s3
    for (let k = 1; k <= 3; k++) {
      const t = k * 0.25;
      const t2 = t * t;
      const t3 = t2 * t;
      const y = 0.5 * (
        (2 * s2) +
        (-s1 + s3) * t +
        (2 * s1 - 5 * s2 + 4 * s3 - s0) * t2 +
        (-s1 + 3 * s2 - 3 * s3 + s0) * t3
      );
      const a = y < 0 ? -y : y;
      if (a > peak) peak = a;
    }
    hist[0] = s1; hist[1] = s2; hist[2] = s3;
    return peak;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const len = inL.length;

    const ceilingDb = parameters.ceiling[0] ?? -1;
    const releaseTime = parameters.release[0] ?? 0.05;
    const lookaheadTime = parameters.lookahead[0] ?? 0.005;

    const ceilingLin = Math.pow(10, ceilingDb / 20);
    const releaseCoeff = Math.exp(-1 / (sampleRate * releaseTime));
    const lookaheadSamples = Math.min(
      Math.max(1, Math.round(lookaheadTime * sampleRate)),
      this.maxDelaySamples - 1
    );

    // Soft-clip only engages within SOFT_RANGE dB of the ceiling.
    // Below ceiling - SOFT_RANGE, output passes through unchanged.
    // This preserves transparency on non-limited signal.
    const SOFT_RANGE_DB = 3;
    const softKnee = Math.pow(10, -SOFT_RANGE_DB / 20); // linear threshold

    for (let i = 0; i < len; i++) {
      const sL = inL[i];
      const sR = inR[i];

      // 4x ISP true-peak detection on current input (fix C4)
      const ispL = this.ispPeak(sL, this.ispHistL);
      const ispR = this.ispPeak(sR, this.ispHistR);
      const trueInputPeak = ispL > ispR ? ispL : ispR;

      // Write current samples AND their ISP peak into the delay line so the
      // envelope reacts to the loudest intersample peak inside lookahead.
      this.delayBufL[this.delayIdx] = sL;
      this.delayBufR[this.delayIdx] = sR;
      this.ispPeakBuf[this.delayIdx] = trueInputPeak;

      // Read delayed signal (the sample we're about to output)
      let readIdx = this.delayIdx - lookaheadSamples;
      if (readIdx < 0) readIdx += this.maxDelaySamples;
      const dL = this.delayBufL[readIdx];
      const dR = this.delayBufR[readIdx];

      // Scan all ISP peaks inside the lookahead window — the envelope
      // must be attenuated enough NOW to tame the loudest future peak.
      let windowPeak = 0;
      for (let k = 0; k <= lookaheadSamples; k++) {
        let idx = this.delayIdx - k;
        if (idx < 0) idx += this.maxDelaySamples;
        const p = this.ispPeakBuf[idx];
        if (p > windowPeak) windowPeak = p;
      }

      this.delayIdx = (this.delayIdx + 1) % this.maxDelaySamples;

      // Required gain factor to keep peak ≤ ceiling (≥1 means reduce)
      let targetGainFactor = 1;
      if (windowPeak > ceilingLin && ceilingLin > 0) {
        targetGainFactor = windowPeak / ceilingLin;
      }

      // Envelope of gain-reduction factor: instant attack (lookahead
      // already provides smoothing), exponential release.
      if (targetGainFactor > this.envelope) {
        this.envelope = targetGainFactor;
      } else {
        this.envelope = releaseCoeff * this.envelope + (1 - releaseCoeff) * targetGainFactor;
      }
      if (this.envelope < 1) this.envelope = 1;

      const gain = 1 / this.envelope;
      let wetL = dL * gain;
      let wetR = dR * gain;

      // Scoped soft clip (fix C5): only warp signal above ceiling*softKnee.
      // Below that, pass through linearly.
      const kneeLin = ceilingLin * softKnee;
      if (wetL > kneeLin) {
        const excess = (wetL - kneeLin) / (ceilingLin - kneeLin);
        wetL = kneeLin + (ceilingLin - kneeLin) * Math.tanh(excess);
      } else if (wetL < -kneeLin) {
        const excess = (-wetL - kneeLin) / (ceilingLin - kneeLin);
        wetL = -(kneeLin + (ceilingLin - kneeLin) * Math.tanh(excess));
      }
      if (wetR > kneeLin) {
        const excess = (wetR - kneeLin) / (ceilingLin - kneeLin);
        wetR = kneeLin + (ceilingLin - kneeLin) * Math.tanh(excess);
      } else if (wetR < -kneeLin) {
        const excess = (-wetR - kneeLin) / (ceilingLin - kneeLin);
        wetR = -(kneeLin + (ceilingLin - kneeLin) * Math.tanh(excess));
      }

      outL[i] = wetL;
      outR[i] = wetR;

      // Track GR
      const grDb = this.envelope > 1 ? 20 * Math.log10(this.envelope) : 0;
      if (grDb > this.peakGR) this.peakGR = grDb;
    }

    // Report
    this.grReportCounter += len;
    if (this.grReportCounter >= 128) {
      this.port.postMessage({ type: 'gainReduction', value: this.peakGR });
      this.peakGR = 0;
      this.grReportCounter = 0;
    }

    return true;
  }
}

registerProcessor('limiter-processor', LimiterProcessor);
