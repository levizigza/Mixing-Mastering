/**
 * 4x Oversampled Saturation AudioWorklet Processor
 * Upsamples → saturates → anti-alias filter → downsamples
 * Eliminates aliasing artifacts from nonlinear waveshaping
 *
 * Models: Tape, Tube, Transformer, Hard Clip, Soft Clip
 */
class OversampledSaturationProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'mix', defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 4 },
      { name: 'bias', defaultValue: 0, minValue: -1, maxValue: 1 },
      { name: 'tone', defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'outputGain', defaultValue: 0, minValue: -12, maxValue: 12 },
    ];
  }

  constructor() {
    super();
    this.oversampleFactor = 4;

    // Anti-aliasing filter (4th order Butterworth lowpass at Nyquist)
    // Two cascaded biquad sections per channel
    this.aaFilters = {
      L: [this.createFilterState(), this.createFilterState()],
      R: [this.createFilterState(), this.createFilterState()],
    };

    // Upsampling filter states
    this.upFilters = {
      L: [this.createFilterState(), this.createFilterState()],
      R: [this.createFilterState(), this.createFilterState()],
    };

    // Pre-compute AA filter coefficients for Nyquist/(oversampleFactor)
    // Butterworth LP at normalized freq = 1/(2*oversampleFactor) of oversampled rate
    this.aaCoeffs = this.computeButterworth(0.5 / this.oversampleFactor);

    // DC blocker
    this.dcStateL = { x1: 0, y1: 0 };
    this.dcStateR = { x1: 0, y1: 0 };

    // Tone filter
    this.toneStateL = 0;
    this.toneStateR = 0;
  }

  createFilterState() {
    return { x1: 0, x2: 0, y1: 0, y2: 0 };
  }

  // Compute Butterworth lowpass coefficients for normalized frequency (0-0.5)
  computeButterworth(normalizedFreq) {
    const w0 = 2 * Math.PI * normalizedFreq;
    const cosW = Math.cos(w0);
    const sinW = Math.sin(w0);
    const alpha = sinW / (2 * 0.7071); // Q = 0.7071 for Butterworth

    const a0 = 1 + alpha;
    return {
      b0: ((1 - cosW) / 2) / a0,
      b1: (1 - cosW) / a0,
      b2: ((1 - cosW) / 2) / a0,
      a1: (-2 * cosW) / a0,
      a2: (1 - alpha) / a0,
    };
  }

  biquadProcess(x, state, coeffs) {
    let y = coeffs.b0 * x + coeffs.b1 * state.x1 + coeffs.b2 * state.x2
              - coeffs.a1 * state.y1 - coeffs.a2 * state.y2;
    if (y > -1e-30 && y < 1e-30) y = 0; // denormal guard
    state.x2 = state.x1;
    state.x1 = x;
    state.y2 = state.y1;
    state.y1 = y;
    return y;
  }

  // Cascade two biquad sections for 4th order
  antiAliasFilter(x, filterPair) {
    let y = this.biquadProcess(x, filterPair[0], this.aaCoeffs);
    y = this.biquadProcess(y, filterPair[1], this.aaCoeffs);
    return y;
  }

  // Saturation functions (same algorithms, but now at 4x sample rate)
  tape(x, drive) {
    const d = 1 + drive * 15;
    const biased = x + 0.05 * drive;
    const sat = Math.tanh(biased * d) / Math.tanh(d);
    return sat - 0.02 * drive * sat * sat;
  }

  tube(x, drive) {
    const d = 1 + drive * 20;
    if (x >= 0) {
      return 1 - Math.exp(-x * d);
    } else {
      return -(1 - Math.exp(x * d * 0.7)) * 1.2;
    }
  }

  transformer(x, drive) {
    const d = 1 + drive * 10;
    const xd = x * d;
    const x2 = xd * xd;
    const sat = xd * (1 - x2 / 3 + x2 * x2 / 5);
    return Math.max(-1, Math.min(1, sat / d));
  }

  hardClip(x, drive) {
    const d = 1 + drive * 10;
    return Math.max(-1, Math.min(1, x * d));
  }

  softClip(x, drive) {
    const d = 1 + drive * 8;
    const xd = x * d;
    if (Math.abs(xd) < 1) {
      return xd - (xd * xd * xd) / 3;
    }
    return xd > 0 ? 2 / 3 : -2 / 3;
  }

  saturate(x, drive, mode) {
    switch (Math.round(mode)) {
      case 0: return this.tape(x, drive);
      case 1: return this.tube(x, drive);
      case 2: return this.transformer(x, drive);
      case 3: return this.hardClip(x, drive);
      case 4: return this.softClip(x, drive);
      default: return this.tape(x, drive);
    }
  }

  dcBlock(x, state) {
    const R = 0.9975;
    const y = x - state.x1 + R * state.y1;
    state.x1 = x;
    state.y1 = y;
    return y;
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

    const drive = parameters.drive[0] ?? 0;
    const mix = parameters.mix[0] ?? 0.5;
    const mode = parameters.mode[0] ?? 0;
    const bias = parameters.bias[0] ?? 0;
    const tone = parameters.tone[0] ?? 0.5;
    const outputGainDb = parameters.outputGain[0] ?? 0;
    const outputGain = Math.pow(10, outputGainDb / 20);

    // Tone control coefficient
    const cutoffFreq = 1000 + tone * 17000;
    const toneCoeff = Math.exp(-2 * Math.PI * cutoffFreq / (sampleRate * this.oversampleFactor));

    if (drive <= 0.001) {
      for (let i = 0; i < len; i++) {
        outL[i] = inL[i];
        outR[i] = inR[i];
      }
      return true;
    }

    for (let i = 0; i < len; i++) {
      const dryL = inL[i];
      const dryR = inR[i];

      // Upsample by 4x (zero-stuffing + interpolation filter)
      let sumL = 0;
      let sumR = 0;

      for (let os = 0; os < this.oversampleFactor; os++) {
        // Zero-stuffing: only first sample has original value, rest are 0
        let osL = os === 0 ? dryL * this.oversampleFactor : 0;
        let osR = os === 0 ? dryR * this.oversampleFactor : 0;

        // Interpolation filter (anti-imaging)
        osL = this.antiAliasFilter(osL, this.upFilters.L);
        osR = this.antiAliasFilter(osR, this.upFilters.R);

        // Add bias
        osL += bias * 0.1;
        osR += bias * 0.1;

        // Saturate at oversampled rate
        let wetL = this.saturate(osL, drive, mode);
        let wetR = this.saturate(osR, drive, mode);

        // Tone control at oversampled rate
        this.toneStateL = toneCoeff * this.toneStateL + (1 - toneCoeff) * wetL;
        this.toneStateR = toneCoeff * this.toneStateR + (1 - toneCoeff) * wetR;
        wetL = this.toneStateL;
        wetR = this.toneStateR;

        // Anti-aliasing filter before downsampling
        wetL = this.antiAliasFilter(wetL, this.aaFilters.L);
        wetR = this.antiAliasFilter(wetR, this.aaFilters.R);

        // Downsample: take every Nth sample (last one)
        if (os === this.oversampleFactor - 1) {
          sumL = wetL;
          sumR = wetR;
        }
      }

      // DC blocker
      sumL = this.dcBlock(sumL, this.dcStateL);
      sumR = this.dcBlock(sumR, this.dcStateR);

      // Dry/wet mix + output gain
      outL[i] = (dryL * (1 - mix) + sumL * mix) * outputGain;
      outR[i] = (dryR * (1 - mix) + sumR * mix) * outputGain;
    }

    return true;
  }
}

registerProcessor('oversampled-saturation-processor', OversampledSaturationProcessor);
