/**
 * Gate/Expander AudioWorklet Processor
 * 
 * Features:
 * - Gate mode (hard) and Expander mode (soft, ratio-based)
 * - Lookahead for transient preservation
 * - Hold time to prevent chatter
 * - Sidechain HPF/LPF for frequency-conscious gating
 * - Hysteresis to prevent rapid open/close
 * - Gain reduction metering
 */
class GateExpanderProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -40, minValue: -80, maxValue: 0 },
      { name: 'ratio', defaultValue: 10, minValue: 1, maxValue: 100 },     // 100 = hard gate
      { name: 'attack', defaultValue: 0.001, minValue: 0.0001, maxValue: 0.1 },
      { name: 'hold', defaultValue: 0.05, minValue: 0, maxValue: 2.0 },
      { name: 'release', defaultValue: 0.1, minValue: 0.005, maxValue: 5.0 },
      { name: 'range', defaultValue: -80, minValue: -80, maxValue: 0 },     // max attenuation
      { name: 'hysteresis', defaultValue: 4, minValue: 0, maxValue: 12 },   // dB below threshold to close
      { name: 'lookahead', defaultValue: 0.001, minValue: 0, maxValue: 0.01 },
      { name: 'scFilterFreq', defaultValue: 0, minValue: 0, maxValue: 20000 },
      { name: 'scFilterType', defaultValue: 0, minValue: 0, maxValue: 2 },  // 0=off, 1=HPF, 2=LPF
      { name: 'scFilterQ', defaultValue: 0.707, minValue: 0.1, maxValue: 10 },
      { name: 'mix', defaultValue: 1.0, minValue: 0, maxValue: 1.0 },
    ];
  }

  constructor() {
    super();
    this.envelope = 0;
    this.gainSmooth = 1;
    this.holdCounter = 0;
    this.gateOpen = false;

    // Lookahead delay buffer
    this.delayBufferL = new Float32Array(512);
    this.delayBufferR = new Float32Array(512);
    this.delayWriteIdx = 0;

    // Sidechain filter state + cached coefficients (fix M9)
    this.scX1 = 0; this.scX2 = 0;
    this.scY1 = 0; this.scY2 = 0;
    this.scCoeffs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
    this.scLastFreq = 0;
    this.scLastType = 0;
    this.scLastQ = 0;

    // Metering
    this.peakGR = 0;
    this.reportCounter = 0;
  }

  getParam(parameters, name, index) {
    const arr = parameters[name];
    return arr.length > 1 ? arr[index] : arr[0];
  }

  // Update cached sidechain biquad coefficients only when parameters change
  // (fix M9). Caller invokes once per process() call, not per sample.
  updateSCCoeffs(freq, type, Q) {
    if (freq <= 0 || type === 0) return;
    if (Math.abs(freq - this.scLastFreq) < 0.5 &&
        type === this.scLastType &&
        Math.abs(Q - this.scLastQ) < 0.001) return;
    this.scLastFreq = freq;
    this.scLastType = type;
    this.scLastQ = Q;

    const w0 = 2 * Math.PI * freq / sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * Q);
    const a0 = 1 + alpha;
    let b0, b1, b2;
    if (type === 1) {
      b0 = (1 + cosW0) / 2; b1 = -(1 + cosW0); b2 = (1 + cosW0) / 2;
    } else {
      b0 = (1 - cosW0) / 2; b1 = 1 - cosW0;   b2 = (1 - cosW0) / 2;
    }
    this.scCoeffs.b0 = b0 / a0;
    this.scCoeffs.b1 = b1 / a0;
    this.scCoeffs.b2 = b2 / a0;
    this.scCoeffs.a1 = (-2 * cosW0) / a0;
    this.scCoeffs.a2 = (1 - alpha) / a0;
  }

  // 2nd-order biquad filter for sidechain (uses cached coeffs)
  processSCFilter(sample, freq, type) {
    if (freq <= 0 || type === 0) return sample;
    const c = this.scCoeffs;
    let y = c.b0 * sample + c.b1 * this.scX1 + c.b2 * this.scX2 - c.a1 * this.scY1 - c.a2 * this.scY2;
    if (y > -1e-30 && y < 1e-30) y = 0; // denormal guard
    this.scX2 = this.scX1;
    this.scX1 = sample;
    this.scY2 = this.scY1;
    this.scY1 = y;
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

    // Hoist k-rate parameters out of the sample loop (fix M10).
    // If the browser provides a-rate arrays, we still want to cache once
    // per block since the jitter in attack/release times is negligible.
    const threshold = this.getParam(parameters, 'threshold', 0);
    const ratio = this.getParam(parameters, 'ratio', 0);
    const attack = this.getParam(parameters, 'attack', 0);
    const hold = this.getParam(parameters, 'hold', 0);
    const release = this.getParam(parameters, 'release', 0);
    const range = this.getParam(parameters, 'range', 0);
    const hysteresis = this.getParam(parameters, 'hysteresis', 0);
    const lookahead = this.getParam(parameters, 'lookahead', 0);
    const scFilterFreq = this.getParam(parameters, 'scFilterFreq', 0);
    const scFilterType = this.getParam(parameters, 'scFilterType', 0);
    const scFilterQ = this.getParam(parameters, 'scFilterQ', 0);
    const mix = this.getParam(parameters, 'mix', 0);

    const attackCoeff = Math.exp(-1 / (sampleRate * attack));
    const releaseCoeff = Math.exp(-1 / (sampleRate * release));
    const delaySamples = Math.min(Math.round(lookahead * sampleRate), 511);
    const openThreshold = threshold;
    const closeThreshold = threshold - hysteresis;
    const holdSamples = Math.round(hold * sampleRate);

    // Cache sidechain filter coefficients once per block (fix M9)
    this.updateSCCoeffs(scFilterFreq, scFilterType, scFilterQ);

    for (let i = 0; i < len; i++) {
      // Lookahead delay
      this.delayBufferL[this.delayWriteIdx] = inL[i];
      this.delayBufferR[this.delayWriteIdx] = inR[i];
      const readIdx = (this.delayWriteIdx - delaySamples + 512) % 512;
      const delayedL = this.delayBufferL[readIdx];
      const delayedR = this.delayBufferR[readIdx];
      this.delayWriteIdx = (this.delayWriteIdx + 1) % 512;

      // Sidechain signal (mono sum of input)
      let scSignal = (Math.abs(inL[i]) + Math.abs(inR[i])) * 0.5;
      scSignal = this.processSCFilter(scSignal, scFilterFreq, scFilterType);
      scSignal = Math.abs(scSignal);


      if (scSignal > this.envelope) {
        this.envelope = attackCoeff * this.envelope + (1 - attackCoeff) * scSignal;
      } else {
        this.envelope = releaseCoeff * this.envelope + (1 - releaseCoeff) * scSignal;
      }

      // Convert to dB
      const envDb = this.envelope > 0 ? 20 * Math.log10(this.envelope) : -120;

      // Gate logic with hysteresis
      if (envDb >= openThreshold) {
        this.gateOpen = true;
        this.holdCounter = holdSamples;
      } else if (envDb < closeThreshold) {
        if (this.holdCounter > 0) {
          this.holdCounter--;
        } else {
          this.gateOpen = false;
        }
      }

      // Compute gain reduction
      let gainDb = 0;
      if (!this.gateOpen) {
        const below = threshold - envDb;
        if (ratio >= 100) {
          // Hard gate
          gainDb = Math.max(range, -below);
        } else {
          // Expander
          gainDb = Math.max(range, -below * (1 - 1 / ratio));
        }
      }

      const targetGain = Math.pow(10, gainDb / 20);

      // Smooth gain transitions
      const smoothCoeff = this.gateOpen
        ? Math.exp(-1 / (sampleRate * attack))
        : Math.exp(-1 / (sampleRate * release));
      this.gainSmooth = smoothCoeff * this.gainSmooth + (1 - smoothCoeff) * targetGain;

      // Apply
      const wetL = delayedL * this.gainSmooth;
      const wetR = delayedR * this.gainSmooth;
      outL[i] = delayedL * (1 - mix) + wetL * mix;
      outR[i] = delayedR * (1 - mix) + wetR * mix;

      // Metering
      const gr = 20 * Math.log10(this.gainSmooth + 1e-10);
      if (gr < this.peakGR) this.peakGR = gr;
    }

    // Report gain reduction
    this.reportCounter += len;
    if (this.reportCounter >= 256) {
      this.port.postMessage({ type: 'gainReduction', value: this.peakGR });
      this.peakGR = 0;
      this.reportCounter = 0;
    }

    return true;
  }
}

registerProcessor('gate-expander-processor', GateExpanderProcessor);
