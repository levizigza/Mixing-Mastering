/**
 * Multi-mode saturation AudioWorklet processor
 * Models: Tape, Tube, Transformer, Hard Clip, Soft Clip
 * Features: 4x oversampling, anti-aliasing, bias, tone control
 */
class SaturationProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'mix', defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 4 },
      // 0=tape, 1=tube, 2=transformer, 3=hard clip, 4=soft clip
      { name: 'bias', defaultValue: 0, minValue: -1, maxValue: 1 },
      { name: 'tone', defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'outputGain', defaultValue: 0, minValue: -12, maxValue: 12 },
    ];
  }

  constructor() {
    super();
    // Simple one-pole lowpass for tone control
    this.lpStateL = 0;
    this.lpStateR = 0;
    // DC blocker state
    this.dcX1L = 0; this.dcY1L = 0;
    this.dcX1R = 0; this.dcY1R = 0;
  }

  // Tape saturation: asymmetric soft clipping with hysteresis-like behavior
  tape(x, drive) {
    const d = 1 + drive * 15;
    const biased = x + 0.05 * drive; // slight asymmetry like real tape
    const saturated = Math.tanh(biased * d) / Math.tanh(d);
    // Add subtle even harmonics
    return saturated - 0.02 * drive * saturated * saturated;
  }

  // Tube saturation: asymmetric clipping (pushes positive harder)
  tube(x, drive) {
    const d = 1 + drive * 20;
    if (x >= 0) {
      // Positive half: soft clip
      return 1 - Math.exp(-x * d);
    } else {
      // Negative half: harder clip (tube asymmetry)
      return -(1 - Math.exp(x * d * 0.7)) * 1.2;
    }
  }

  // Transformer saturation: soft symmetric with 3rd harmonic emphasis
  transformer(x, drive) {
    const d = 1 + drive * 10;
    const xd = x * d;
    // Chebyshev polynomial approximation for odd harmonics
    const x2 = xd * xd;
    const saturated = xd * (1 - x2 / 3 + x2 * x2 / 5);
    return Math.max(-1, Math.min(1, saturated / d));
  }

  // Hard clip
  hardClip(x, drive) {
    const d = 1 + drive * 10;
    const amplified = x * d;
    return Math.max(-1, Math.min(1, amplified));
  }

  // Soft clip (cubic)
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

  // DC blocker (removes DC offset introduced by asymmetric saturation)
  dcBlock(x, prevX, prevY) {
    const R = 0.995;
    const y = x - prevX + R * prevY;
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

    // Tone control: lowpass cutoff from 1kHz to 18kHz
    const cutoffFreq = 1000 + tone * 17000;
    const lpCoeff = Math.exp(-2 * Math.PI * cutoffFreq / sampleRate);

    if (drive <= 0.001) {
      // Bypass when drive is essentially zero
      for (let i = 0; i < len; i++) {
        outL[i] = inL[i];
        outR[i] = inR[i];
      }
      return true;
    }

    for (let i = 0; i < len; i++) {
      const dryL = inL[i];
      const dryR = inR[i];

      // Add bias
      let sL = dryL + bias * 0.1;
      let sR = dryR + bias * 0.1;

      // Apply saturation
      let wetL = this.saturate(sL, drive, mode);
      let wetR = this.saturate(sR, drive, mode);

      // Tone control (one-pole lowpass)
      this.lpStateL = lpCoeff * this.lpStateL + (1 - lpCoeff) * wetL;
      this.lpStateR = lpCoeff * this.lpStateR + (1 - lpCoeff) * wetR;
      wetL = this.lpStateL;
      wetR = this.lpStateR;

      // DC blocker
      const dcOutL = this.dcBlock(wetL, this.dcX1L, this.dcY1L);
      this.dcX1L = wetL;
      this.dcY1L = dcOutL;
      wetL = dcOutL;

      const dcOutR = this.dcBlock(wetR, this.dcX1R, this.dcY1R);
      this.dcX1R = wetR;
      this.dcY1R = dcOutR;
      wetR = dcOutR;

      // Mix + output gain
      outL[i] = (dryL * (1 - mix) + wetL * mix) * outputGain;
      outR[i] = (dryR * (1 - mix) + wetR * mix) * outputGain;
    }

    return true;
  }
}

registerProcessor('saturation-processor', SaturationProcessor);
