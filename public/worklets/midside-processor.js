/**
 * Mid/Side encoder-decoder + stereo width AudioWorklet processor
 * Can process M/S independently, adjust width, mono bass below threshold
 */
class MidSideProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'width', defaultValue: 1.0, minValue: 0, maxValue: 3.0 },
      { name: 'midGain', defaultValue: 0, minValue: -18, maxValue: 18 },
      { name: 'sideGain', defaultValue: 0, minValue: -18, maxValue: 18 },
      { name: 'monoFreq', defaultValue: 0, minValue: 0, maxValue: 500 },
      // monoFreq > 0: frequencies below this become mono (bass mono)
      { name: 'balance', defaultValue: 0, minValue: -1, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    // Bass mono crossover filter states (LR2)
    this.lpStateL = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.lpStateR = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.hpStateL = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.hpStateR = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.lastMonoFreq = 0;
    this.lpB = [0, 0, 0];
    this.lpA = [0, 0];
    this.hpB = [0, 0, 0];
    this.hpA = [0, 0];
  }

  computeFilter(freq) {
    if (Math.abs(freq - this.lastMonoFreq) < 0.5) return;
    this.lastMonoFreq = freq;

    const w0 = 2 * Math.PI * freq / sampleRate;
    const cos_w0 = Math.cos(w0);
    const sin_w0 = Math.sin(w0);
    const alpha = sin_w0 / (2 * 0.707);

    // Lowpass
    const b0lp = (1 - cos_w0) / 2;
    const b1lp = 1 - cos_w0;
    const b2lp = (1 - cos_w0) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cos_w0;
    const a2 = 1 - alpha;

    this.lpB = [b0lp / a0, b1lp / a0, b2lp / a0];
    this.lpA = [a1 / a0, a2 / a0];

    // Highpass
    const b0hp = (1 + cos_w0) / 2;
    const b1hp = -(1 + cos_w0);
    const b2hp = (1 + cos_w0) / 2;

    this.hpB = [b0hp / a0, b1hp / a0, b2hp / a0];
    this.hpA = [a1 / a0, a2 / a0];
  }

  biquad(x, state, b, a) {
    let y = b[0] * x + b[1] * state.x1 + b[2] * state.x2 - a[0] * state.y1 - a[1] * state.y2;
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

    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const len = inL.length;

    const width = parameters.width[0] ?? 1;
    const midGainLin = Math.pow(10, (parameters.midGain[0] ?? 0) / 20);
    const sideGainLin = Math.pow(10, (parameters.sideGain[0] ?? 0) / 20);
    const monoFreq = parameters.monoFreq[0] ?? 0;
    const balance = parameters.balance[0] ?? 0;

    const useBassMono = monoFreq > 20;
    if (useBassMono) {
      this.computeFilter(monoFreq);
    }

    for (let i = 0; i < len; i++) {
      let L = inL[i];
      let R = inR[i];

      // Bass mono: mono everything below monoFreq
      if (useBassMono) {
        const lowL = this.biquad(L, this.lpStateL, this.lpB, this.lpA);
        const lowR = this.biquad(R, this.lpStateR, this.lpB, this.lpA);
        const highL = this.biquad(L, this.hpStateL, this.hpB, this.hpA);
        const highR = this.biquad(R, this.hpStateR, this.hpB, this.hpA);

        // Mono the lows
        const monoLow = (lowL + lowR) * 0.5;
        L = monoLow + highL;
        R = monoLow + highR;
      }

      // Encode to Mid/Side
      const mid = (L + R) * 0.5;
      const side = (L - R) * 0.5;

      // Apply gains and width
      const processedMid = mid * midGainLin;
      const processedSide = side * sideGainLin * width;

      // Decode back to L/R
      let newL = processedMid + processedSide;
      let newR = processedMid - processedSide;

      // Stereo balance
      if (balance !== 0) {
        if (balance > 0) {
          newL *= 1 - balance;
        } else {
          newR *= 1 + balance;
        }
      }

      outL[i] = newL;
      outR[i] = newR;
    }

    return true;
  }
}

registerProcessor('midside-processor', MidSideProcessor);
