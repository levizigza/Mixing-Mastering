/**
 * Sidechain Compressor AudioWorklet Processor
 * Input 0: Audio signal to compress
 * Input 1: External sidechain signal (key input)
 * 
 * The sidechain signal controls the gain reduction applied to the main signal.
 * Used for ducking (e.g., kick → bass), de-essing, vocal riding, etc.
 */
class SidechainCompressorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -24, minValue: -60, maxValue: 0 },
      { name: 'ratio', defaultValue: 4, minValue: 1, maxValue: 100 },
      { name: 'attack', defaultValue: 0.003, minValue: 0.0001, maxValue: 0.5 },
      { name: 'release', defaultValue: 0.25, minValue: 0.005, maxValue: 5.0 },
      { name: 'knee', defaultValue: 6, minValue: 0, maxValue: 40 },
      { name: 'makeupGain', defaultValue: 0, minValue: -12, maxValue: 36 },
      { name: 'mix', defaultValue: 1.0, minValue: 0, maxValue: 1 },
      { name: 'range', defaultValue: -40, minValue: -80, maxValue: 0 },
      // range: max amount of gain reduction in dB (limits ducking depth)
      { name: 'scFilterFreq', defaultValue: 0, minValue: 0, maxValue: 20000 },
      // sidechain HPF: filter the key signal to focus on specific frequency range
      { name: 'scFilterType', defaultValue: 0, minValue: 0, maxValue: 2 },
      // 0=off, 1=highpass, 2=bandpass
      { name: 'scFilterQ', defaultValue: 1, minValue: 0.1, maxValue: 10 },
      { name: 'lookahead', defaultValue: 0.005, minValue: 0, maxValue: 0.02 },
    ];
  }

  constructor(options) {
    super(options);
    this.envelope = 0;
    this.gainReduction = 0;

    // Lookahead delay buffer (max 20ms at 48kHz = 960 samples)
    this.maxLookaheadSamples = 960;
    this.delayBufferL = new Float32Array(this.maxLookaheadSamples);
    this.delayBufferR = new Float32Array(this.maxLookaheadSamples);
    this.delayWriteIndex = 0;

    // Sidechain filter state
    this.scFilterState = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.scFilterCoeffs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
    this.lastScFreq = 0;
    this.lastScType = 0;
    this.lastScQ = 0;

    // Metering
    this.peakGR = 0;
    this.grReportCounter = 0;
  }

  computeScFilter(freq, type, Q) {
    if (Math.abs(freq - this.lastScFreq) < 1 &&
        type === this.lastScType &&
        Math.abs(Q - this.lastScQ) < 0.01) return;

    this.lastScFreq = freq;
    this.lastScType = type;
    this.lastScQ = Q;

    const w0 = 2 * Math.PI * freq / sampleRate;
    const cosW = Math.cos(w0);
    const sinW = Math.sin(w0);
    const alpha = sinW / (2 * Q);

    let b0, b1, b2, a0, a1, a2;

    if (type === 1) {
      // Highpass
      b0 = (1 + cosW) / 2;
      b1 = -(1 + cosW);
      b2 = (1 + cosW) / 2;
    } else {
      // Bandpass
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    a0 = 1 + alpha;
    a1 = -2 * cosW;
    a2 = 1 - alpha;

    this.scFilterCoeffs = {
      b0: b0 / a0,
      b1: b1 / a0,
      b2: b2 / a0,
      a1: a1 / a0,
      a2: a2 / a0,
    };
  }

  biquad(x, state, coeffs) {
    let y = coeffs.b0 * x + coeffs.b1 * state.x1 + coeffs.b2 * state.x2
              - coeffs.a1 * state.y1 - coeffs.a2 * state.y2;
    if (y > -1e-30 && y < 1e-30) y = 0; // denormal guard
    state.x2 = state.x1;
    state.x1 = x;
    state.y2 = state.y1;
    state.y1 = y;
    return y;
  }

  process(inputs, outputs, parameters) {
    const mainInput = inputs[0];   // Signal to compress
    const scInput = inputs[1];     // Sidechain (key) signal
    const output = outputs[0];

    if (!mainInput || !mainInput[0]) return true;

    const inL = mainInput[0];
    const inR = mainInput[1] || mainInput[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const len = inL.length;

    // Sidechain signal (falls back to main input if no sidechain connected)
    const scL = scInput?.[0] || inL;
    const scR = scInput?.[1] || scInput?.[0] || inR;

    const threshold = parameters.threshold[0] ?? -24;
    const ratio = parameters.ratio[0] ?? 4;
    const attackTime = parameters.attack[0] ?? 0.003;
    const releaseTime = parameters.release[0] ?? 0.25;
    const kneeWidth = parameters.knee[0] ?? 6;
    const makeupGainDb = parameters.makeupGain[0] ?? 0;
    const mix = parameters.mix[0] ?? 1;
    const rangeDb = parameters.range[0] ?? -40;
    const scFilterFreq = parameters.scFilterFreq[0] ?? 0;
    const scFilterType = Math.round(parameters.scFilterType[0] ?? 0);
    const scFilterQ = parameters.scFilterQ[0] ?? 1;
    const lookaheadTime = parameters.lookahead[0] ?? 0.005;

    const attackCoeff = Math.exp(-1 / (sampleRate * attackTime));
    const releaseCoeff = Math.exp(-1 / (sampleRate * releaseTime));
    const makeupLinear = Math.pow(10, makeupGainDb / 20);
    const maxGR = Math.abs(rangeDb); // max gain reduction in dB (positive)
    const lookaheadSamples = Math.min(
      Math.round(lookaheadTime * sampleRate),
      this.maxLookaheadSamples - 1
    );

    // Update sidechain filter
    if (scFilterFreq > 20 && scFilterType > 0) {
      this.computeScFilter(scFilterFreq, scFilterType, scFilterQ);
    }

    for (let i = 0; i < len; i++) {
      // Write main signal to lookahead delay
      this.delayBufferL[this.delayWriteIndex] = inL[i];
      this.delayBufferR[this.delayWriteIndex] = inR[i];

      // Read delayed main signal
      let readIndex = this.delayWriteIndex - lookaheadSamples;
      if (readIndex < 0) readIndex += this.maxLookaheadSamples;
      const delayedL = this.delayBufferL[readIndex];
      const delayedR = this.delayBufferR[readIndex];

      this.delayWriteIndex = (this.delayWriteIndex + 1) % this.maxLookaheadSamples;

      // Process sidechain signal
      let scMono = (scL[i] + scR[i]) * 0.5;

      // Apply sidechain filter
      if (scFilterFreq > 20 && scFilterType > 0) {
        scMono = this.biquad(scMono, this.scFilterState, this.scFilterCoeffs);
      }

      // Level detection on sidechain
      const level = Math.abs(scMono);
      const levelDb = level > 1e-10 ? 20 * Math.log10(level) : -120;

      // Gain computation with soft knee
      let gainReductionDb = 0;
      const halfKnee = kneeWidth / 2;

      if (kneeWidth > 0 && levelDb > threshold - halfKnee && levelDb < threshold + halfKnee) {
        const x = levelDb - threshold + halfKnee;
        gainReductionDb = ((1 / ratio - 1) * x * x) / (2 * kneeWidth);
      } else if (levelDb >= threshold + halfKnee) {
        gainReductionDb = (threshold + (levelDb - threshold) / ratio) - levelDb;
      }

      // Clamp to range
      gainReductionDb = Math.max(gainReductionDb, -maxGR);

      // Envelope follower
      const targetEnvelope = -gainReductionDb;
      if (targetEnvelope > this.envelope) {
        this.envelope = attackCoeff * this.envelope + (1 - attackCoeff) * targetEnvelope;
      } else {
        this.envelope = releaseCoeff * this.envelope + (1 - releaseCoeff) * targetEnvelope;
      }

      const gainDb = -this.envelope;
      const gainLinear = Math.pow(10, gainDb / 20);

      // Apply to delayed main signal
      const wetL = delayedL * gainLinear * makeupLinear;
      const wetR = delayedR * gainLinear * makeupLinear;

      // Dry/wet mix
      outL[i] = delayedL * (1 - mix) + wetL * mix;
      outR[i] = delayedR * (1 - mix) + wetR * mix;

      // Track GR
      if (this.envelope > this.peakGR) this.peakGR = this.envelope;
    }

    // Report
    this.grReportCounter += len;
    if (this.grReportCounter >= 128) {
      this.port.postMessage({
        type: 'gainReduction',
        value: this.peakGR,
      });
      this.peakGR = 0;
      this.grReportCounter = 0;
    }

    return true;
  }
}

registerProcessor('sidechain-compressor-processor', SidechainCompressorProcessor);
