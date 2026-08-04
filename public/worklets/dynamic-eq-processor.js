/**
 * Dynamic EQ / De-Esser AudioWorklet Processor
 * 4 bands of frequency-dependent compression/expansion
 * Each band detects level independently and applies gain only when threshold exceeded
 * Can function as a de-esser (target sibilance range with compression)
 */
class DynamicEQProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Band 0
      { name: 'freq0', defaultValue: 200, minValue: 20, maxValue: 20000 },
      { name: 'gain0', defaultValue: 0, minValue: -18, maxValue: 18 },
      { name: 'q0', defaultValue: 1, minValue: 0.1, maxValue: 20 },
      { name: 'threshold0', defaultValue: -24, minValue: -60, maxValue: 0 },
      { name: 'ratio0', defaultValue: 2, minValue: 0.1, maxValue: 20 },
      { name: 'attack0', defaultValue: 0.005, minValue: 0.0001, maxValue: 0.5 },
      { name: 'release0', defaultValue: 0.05, minValue: 0.005, maxValue: 2 },
      { name: 'mode0', defaultValue: 0, minValue: 0, maxValue: 1 }, // 0=compress, 1=expand
      // Band 1
      { name: 'freq1', defaultValue: 2000, minValue: 20, maxValue: 20000 },
      { name: 'gain1', defaultValue: 0, minValue: -18, maxValue: 18 },
      { name: 'q1', defaultValue: 1, minValue: 0.1, maxValue: 20 },
      { name: 'threshold1', defaultValue: -24, minValue: -60, maxValue: 0 },
      { name: 'ratio1', defaultValue: 2, minValue: 0.1, maxValue: 20 },
      { name: 'attack1', defaultValue: 0.005, minValue: 0.0001, maxValue: 0.5 },
      { name: 'release1', defaultValue: 0.05, minValue: 0.005, maxValue: 2 },
      { name: 'mode1', defaultValue: 0, minValue: 0, maxValue: 1 },
      // Band 2 (de-esser range)
      { name: 'freq2', defaultValue: 6000, minValue: 20, maxValue: 20000 },
      { name: 'gain2', defaultValue: 0, minValue: -18, maxValue: 18 },
      { name: 'q2', defaultValue: 2, minValue: 0.1, maxValue: 20 },
      { name: 'threshold2', defaultValue: -20, minValue: -60, maxValue: 0 },
      { name: 'ratio2', defaultValue: 4, minValue: 0.1, maxValue: 20 },
      { name: 'attack2', defaultValue: 0.001, minValue: 0.0001, maxValue: 0.5 },
      { name: 'release2', defaultValue: 0.03, minValue: 0.005, maxValue: 2 },
      { name: 'mode2', defaultValue: 0, minValue: 0, maxValue: 1 },
      // Band 3
      { name: 'freq3', defaultValue: 10000, minValue: 20, maxValue: 20000 },
      { name: 'gain3', defaultValue: 0, minValue: -18, maxValue: 18 },
      { name: 'q3', defaultValue: 1, minValue: 0.1, maxValue: 20 },
      { name: 'threshold3', defaultValue: -24, minValue: -60, maxValue: 0 },
      { name: 'ratio3', defaultValue: 2, minValue: 0.1, maxValue: 20 },
      { name: 'attack3', defaultValue: 0.005, minValue: 0.0001, maxValue: 0.5 },
      { name: 'release3', defaultValue: 0.05, minValue: 0.005, maxValue: 2 },
      { name: 'mode3', defaultValue: 0, minValue: 0, maxValue: 1 },
      // Global
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();

    // Per-band detection filters (bandpass) and envelope followers
    this.bands = [];
    for (let i = 0; i < 4; i++) {
      this.bands.push({
        // Detection bandpass filter state (2nd order)
        bpL: { x1: 0, x2: 0, y1: 0, y2: 0 },
        bpR: { x1: 0, x2: 0, y1: 0, y2: 0 },
        // Processing bell filter state (for applying gain)
        bellL: { x1: 0, x2: 0, y1: 0, y2: 0 },
        bellR: { x1: 0, x2: 0, y1: 0, y2: 0 },
        // Filter coefficients
        bpCoeffs: { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0 },
        bellCoeffs: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 },
        // Envelope
        envelope: 0,
        lastFreq: 0,
        lastQ: 0,
        lastDynGain: 0,
        lastBellGain: 999, // force first recomputation
        // Gain reduction metering
        gr: 0,
      });
    }

    this.reportCounter = 0;
  }

  computeBandpass(freq, Q) {
    const w0 = 2 * Math.PI * freq / sampleRate;
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha;
    return {
      b0: alpha / a0,
      b1: 0,
      b2: -alpha / a0,
      a1: (-2 * Math.cos(w0)) / a0,
      a2: (1 - alpha) / a0,
    };
  }

  computePeaking(freq, Q, gainDb) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = 2 * Math.PI * freq / sampleRate;
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha / A;
    return {
      b0: (1 + alpha * A) / a0,
      b1: (-2 * Math.cos(w0)) / a0,
      b2: (1 - alpha * A) / a0,
      a1: (-2 * Math.cos(w0)) / a0,
      a2: (1 - alpha / A) / a0,
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
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const enabled = (parameters.enabled?.[0] ?? 1) > 0.5;
    if (!enabled) {
      for (let ch = 0; ch < output.length; ch++) {
        if (input[ch]) output[ch].set(input[ch]);
      }
      return true;
    }

    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const len = inL.length;

    // Update per-band filter coefficients
    for (let b = 0; b < 4; b++) {
      const freq = parameters[`freq${b}`]?.[0] ?? 1000;
      const Q = parameters[`q${b}`]?.[0] ?? 1;
      const band = this.bands[b];

      if (Math.abs(freq - band.lastFreq) > 1 || Math.abs(Q - band.lastQ) > 0.01) {
        band.bpCoeffs = this.computeBandpass(freq, Q);
        band.lastFreq = freq;
        band.lastQ = Q;
      }
    }

    // Process each sample
    for (let i = 0; i < len; i++) {
      let sampleL = inL[i];
      let sampleR = inR[i];

      // Apply each dynamic EQ band
      for (let b = 0; b < 4; b++) {
        const band = this.bands[b];
        const threshold = parameters[`threshold${b}`]?.[0] ?? -24;
        const ratio = parameters[`ratio${b}`]?.[0] ?? 2;
        const attackTime = parameters[`attack${b}`]?.[0] ?? 0.005;
        const releaseTime = parameters[`release${b}`]?.[0] ?? 0.05;
        const staticGain = parameters[`gain${b}`]?.[0] ?? 0;
        const mode = parameters[`mode${b}`]?.[0] ?? 0;
        const freq = parameters[`freq${b}`]?.[0] ?? 1000;
        const Q = parameters[`q${b}`]?.[0] ?? 1;

        // Detect level in this frequency band
        const detL = this.biquad(sampleL, band.bpL, band.bpCoeffs);
        const detR = this.biquad(sampleR, band.bpR, band.bpCoeffs);
        const detLevel = Math.max(Math.abs(detL), Math.abs(detR));
        const detDb = detLevel > 1e-10 ? 20 * Math.log10(detLevel) : -120;

        // Envelope follower
        const attackCoeff = Math.exp(-1 / (sampleRate * attackTime));
        const releaseCoeff = Math.exp(-1 / (sampleRate * releaseTime));

        if (detLevel > band.envelope) {
          band.envelope = attackCoeff * band.envelope + (1 - attackCoeff) * detLevel;
        } else {
          band.envelope = releaseCoeff * band.envelope + (1 - releaseCoeff) * detLevel;
        }

        const envDb = band.envelope > 1e-10 ? 20 * Math.log10(band.envelope) : -120;

        // Compute dynamic gain
        let dynGainDb = staticGain;

        if (mode < 0.5) {
          // Compression: reduce gain when above threshold
          if (envDb > threshold) {
            const excess = envDb - threshold;
            const compressed = excess / ratio;
            dynGainDb = staticGain - (excess - compressed);
          }
        } else {
          // Expansion: increase gain when above threshold
          if (envDb > threshold) {
            const excess = envDb - threshold;
            dynGainDb = staticGain + excess * (ratio - 1);
            dynGainDb = Math.min(dynGainDb, 18); // Safety limit
          }
        }

        // Smooth gain changes with proper envelope follower (fix M7)
        // τ = 10 ms — sample-rate-independent.
        const gainSmoothCoeff = Math.exp(-1 / (sampleRate * 0.010));
        band.lastDynGain = gainSmoothCoeff * band.lastDynGain
                         + (1 - gainSmoothCoeff) * dynGainDb;

        // Apply peaking filter with dynamic gain. Recompute coefficients
        // only when gain changed by >0.1 dB or freq/Q changed (fix M5).
        if (Math.abs(band.lastDynGain - band.lastBellGain) > 0.1 ||
            freq !== band.lastFreq || Q !== band.lastQ) {
          band.bellCoeffs = this.computePeaking(freq, Q, band.lastDynGain);
          band.lastBellGain = band.lastDynGain;
        }
        sampleL = this.biquad(sampleL, band.bellL, band.bellCoeffs);
        sampleR = this.biquad(sampleR, band.bellR, band.bellCoeffs);

        band.gr = Math.max(band.gr, Math.abs(band.lastDynGain - staticGain));
      }

      outL[i] = sampleL;
      outR[i] = sampleR;
    }

    // Report gain reduction
    this.reportCounter += len;
    if (this.reportCounter >= 256) {
      this.port.postMessage({
        type: 'dynamicEQ',
        gr: this.bands.map(b => {
          const val = b.gr;
          b.gr = 0;
          return val;
        }),
      });
      this.reportCounter = 0;
    }

    return true;
  }
}

registerProcessor('dynamic-eq-processor', DynamicEQProcessor);
