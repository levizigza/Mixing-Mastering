/**
 * Pro-grade compressor AudioWorklet processor
 * Features: RMS + peak detection, lookahead, soft/hard knee,
 * program-dependent release, sidechain filter, makeup gain
 */
class CompressorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -24, minValue: -60, maxValue: 0 },
      { name: 'ratio', defaultValue: 4, minValue: 1, maxValue: 100 },
      { name: 'attack', defaultValue: 0.003, minValue: 0.0001, maxValue: 0.5 },
      { name: 'release', defaultValue: 0.25, minValue: 0.005, maxValue: 5.0 },
      { name: 'knee', defaultValue: 6, minValue: 0, maxValue: 40 },
      { name: 'makeupGain', defaultValue: 0, minValue: -12, maxValue: 36 },
      { name: 'mix', defaultValue: 1.0, minValue: 0, maxValue: 1 },
      { name: 'lookahead', defaultValue: 0.005, minValue: 0, maxValue: 0.02 },
      { name: 'detectionMode', defaultValue: 0, minValue: 0, maxValue: 1 }, // 0=peak, 1=RMS
      { name: 'autoMakeup', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'scFilterFreq', defaultValue: 0, minValue: 0, maxValue: 20000 }, // 0=off
    ];
  }

  constructor() {
    super();
    this.envelope = 0;
    this.gainReduction = 0;

    // RMS running sum — O(1) update per sample (fix C6)
    this.rmsWindowSize = 1024;
    this.rmsBuffer = new Float32Array(this.rmsWindowSize); // stores x²
    this.rmsIndex = 0;
    this.rmsRunningSum = 0;

    // Lookahead delay buffer (max 20ms at 48kHz = 960 samples)
    this.maxLookaheadSamples = 960;
    this.delayBufferL = new Float32Array(this.maxLookaheadSamples);
    this.delayBufferR = new Float32Array(this.maxLookaheadSamples);
    this.delayWriteIndex = 0;

    // Per-channel sidechain 1-pole HPF state (fix C7)
    this.scX1L = 0; this.scY1L = 0;
    this.scX1R = 0; this.scY1R = 0;

    // Report gain reduction to main thread
    this.grReportCounter = 0;
    this.grReportInterval = 128;
    this.peakGR = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const inputL = input[0];
    const inputR = input[1] || input[0];
    const outputL = output[0];
    const outputR = output[1] || output[0];
    const numSamples = inputL.length;

    const threshold = parameters.threshold[0] ?? -24;
    const ratio = parameters.ratio[0] ?? 4;
    const attackTime = parameters.attack[0] ?? 0.003;
    const releaseTime = parameters.release[0] ?? 0.25;
    const kneeWidth = parameters.knee[0] ?? 6;
    const makeupGainDb = parameters.makeupGain[0] ?? 0;
    const mix = parameters.mix[0] ?? 1;
    const lookaheadTime = parameters.lookahead[0] ?? 0.005;
    const detectionMode = parameters.detectionMode[0] ?? 0;
    const autoMakeup = parameters.autoMakeup[0] ?? 0;
    const scFilterFreq = parameters.scFilterFreq[0] ?? 0;

    const attackCoeff = Math.exp(-1 / (sampleRate * attackTime));
    const releaseCoeff = Math.exp(-1 / (sampleRate * releaseTime));
    const makeupLinear = Math.pow(10, makeupGainDb / 20);
    const lookaheadSamples = Math.min(
      Math.round(lookaheadTime * sampleRate),
      this.maxLookaheadSamples - 1
    );

    // Auto makeup gain estimation
    let autoMakeupGain = 1;
    if (autoMakeup > 0.5) {
      const estimatedGR = (threshold * (1 - 1 / ratio)) / 2;
      autoMakeupGain = Math.pow(10, -estimatedGR / 20);
    }

    // Sidechain highpass coefficient
    let scAlpha = 0;
    if (scFilterFreq > 20) {
      const rc = 1.0 / (2 * Math.PI * scFilterFreq);
      scAlpha = rc / (rc + 1.0 / sampleRate);
    }

    for (let i = 0; i < numSamples; i++) {
      const dryL = inputL[i];
      const dryR = inputR[i];

      // Write to lookahead delay buffer
      this.delayBufferL[this.delayWriteIndex] = dryL;
      this.delayBufferR[this.delayWriteIndex] = dryR;

      // Read from delay buffer
      let readIndex = this.delayWriteIndex - lookaheadSamples;
      if (readIndex < 0) readIndex += this.maxLookaheadSamples;
      const delayedL = this.delayBufferL[readIndex];
      const delayedR = this.delayBufferR[readIndex];

      this.delayWriteIndex = (this.delayWriteIndex + 1) % this.maxLookaheadSamples;

      // Detection signal (optionally highpass filtered for sidechain)
      // Independent stereo 1-pole HPF (fix C7)
      let detectL = dryL;
      let detectR = dryR;
      if (scAlpha > 0) {
        const yL = scAlpha * (this.scY1L + detectL - this.scX1L);
        this.scX1L = detectL;
        this.scY1L = yL;
        detectL = yL;
        const yR = scAlpha * (this.scY1R + detectR - this.scX1R);
        this.scX1R = detectR;
        this.scY1R = yR;
        detectR = yR;
      }

      // Level detection
      let level;
      if (detectionMode > 0.5) {
        // RMS detection — O(1) running sum (fix C6)
        const sample = (Math.abs(detectL) + Math.abs(detectR)) * 0.5;
        const sq = sample * sample;
        this.rmsRunningSum += sq - this.rmsBuffer[this.rmsIndex];
        this.rmsBuffer[this.rmsIndex] = sq;
        this.rmsIndex = (this.rmsIndex + 1) % this.rmsWindowSize;
        const ms = this.rmsRunningSum > 0 ? this.rmsRunningSum / this.rmsWindowSize : 0;
        level = Math.sqrt(ms);
      } else {
        // Peak detection
        level = Math.max(Math.abs(detectL), Math.abs(detectR));
      }

      const levelDb = level > 1e-10 ? 20 * Math.log10(level) : -120;

      // Gain computation with soft knee
      let gainReductionDb = 0;
      const halfKnee = kneeWidth / 2;

      if (kneeWidth > 0 && levelDb > threshold - halfKnee && levelDb < threshold + halfKnee) {
        // Soft knee region
        const x = levelDb - threshold + halfKnee;
        gainReductionDb = ((1 / ratio - 1) * x * x) / (2 * kneeWidth);
      } else if (levelDb >= threshold + halfKnee) {
        // Above knee
        gainReductionDb = (threshold + (levelDb - threshold) / ratio) - levelDb;
      }
      // Below threshold: no gain reduction

      // Envelope follower (smooth the gain reduction)
      const targetEnvelope = -gainReductionDb;
      if (targetEnvelope > this.envelope) {
        this.envelope = attackCoeff * this.envelope + (1 - attackCoeff) * targetEnvelope;
      } else {
        // Program-dependent release: faster release for transients
        const adaptiveRelease = releaseCoeff + (1 - releaseCoeff) * 0.1 * (this.envelope - targetEnvelope);
        this.envelope = Math.min(adaptiveRelease, 0.9999) * this.envelope + (1 - Math.min(adaptiveRelease, 0.9999)) * targetEnvelope;
      }

      const gainDb = -this.envelope;
      const gainLinear = Math.pow(10, gainDb / 20);

      // Apply gain to delayed signal
      const wetL = delayedL * gainLinear * makeupLinear * autoMakeupGain;
      const wetR = delayedR * gainLinear * makeupLinear * autoMakeupGain;

      // Parallel (dry/wet) mix
      outputL[i] = delayedL * (1 - mix) + wetL * mix;
      outputR[i] = delayedR * (1 - mix) + wetR * mix;

      // Track gain reduction for metering
      this.gainReduction = this.envelope;
      if (this.envelope > this.peakGR) this.peakGR = this.envelope;
    }

    // Report gain reduction periodically
    this.grReportCounter += numSamples;
    if (this.grReportCounter >= this.grReportInterval) {
      this.port.postMessage({ type: 'gainReduction', value: this.peakGR });
      this.peakGR = 0;
      this.grReportCounter = 0;
    }

    return true;
  }
}

registerProcessor('compressor-processor', CompressorProcessor);
