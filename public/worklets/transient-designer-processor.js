/**
 * Transient Designer AudioWorklet Processor
 * Shapes attack and sustain independently using envelope detection
 * 
 * Algorithm:
 * 1. Detect transients via fast envelope vs slow envelope difference
 * 2. Split signal into transient (attack) and sustain components
 * 3. Apply independent gain to each
 * 4. Recombine
 */
class TransientDesignerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'attack', defaultValue: 0, minValue: -24, maxValue: 24 },    // dB boost/cut to transient
      { name: 'sustain', defaultValue: 0, minValue: -24, maxValue: 24 },   // dB boost/cut to sustain
      { name: 'speed', defaultValue: 50, minValue: 1, maxValue: 200 },     // detection speed (ms)
      { name: 'sensitivity', defaultValue: 0, minValue: -12, maxValue: 12 }, // threshold offset
      { name: 'mix', defaultValue: 1.0, minValue: 0, maxValue: 1 },
      { name: 'outputGain', defaultValue: 0, minValue: -12, maxValue: 12 },
    ];
  }

  constructor() {
    super();
    // Fast envelope (tracks transients)
    this.fastEnvL = 0;
    this.fastEnvR = 0;
    // Slow envelope (tracks sustain/average level)
    this.slowEnvL = 0;
    this.slowEnvR = 0;
    // Smoothed gain for transient component
    this.transientGainSmooth = 1;
    this.sustainGainSmooth = 1;

    // Metering
    this.peakTransient = 0;
    this.reportCounter = 0;
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

    const attackDb = parameters.attack[0] ?? 0;
    const sustainDb = parameters.sustain[0] ?? 0;
    const speedMs = parameters.speed[0] ?? 50;
    const sensitivity = parameters.sensitivity[0] ?? 0;
    const mixAmount = parameters.mix[0] ?? 1;
    const outputGainDb = parameters.outputGain[0] ?? 0;
    const outputGain = Math.pow(10, outputGainDb / 20);

    // If no processing needed, pass through
    if (Math.abs(attackDb) < 0.1 && Math.abs(sustainDb) < 0.1) {
      for (let i = 0; i < len; i++) {
        outL[i] = inL[i] * outputGain;
        outR[i] = (inR[i] || inL[i]) * outputGain;
      }
      return true;
    }

    // Envelope time constants
    const fastAttackTime = 0.0001; // ~0.1ms - catches transients
    const fastReleaseTime = (speedMs / 1000) * 0.5; // proportional to speed
    const slowAttackTime = speedMs / 1000; // full speed window
    const slowReleaseTime = speedMs / 1000 * 3; // 3x speed for sustain tail

    const fastAttackCoeff = Math.exp(-1 / (sampleRate * fastAttackTime));
    const fastReleaseCoeff = Math.exp(-1 / (sampleRate * fastReleaseTime));
    const slowAttackCoeff = Math.exp(-1 / (sampleRate * slowAttackTime));
    const slowReleaseCoeff = Math.exp(-1 / (sampleRate * slowReleaseTime));

    // Convert dB gains to linear
    const attackGainTarget = Math.pow(10, attackDb / 20);
    const sustainGainTarget = Math.pow(10, sustainDb / 20);
    const sensitivityLinear = Math.pow(10, sensitivity / 20);

    // Gain smoothing
    const gainSmoothCoeff = Math.exp(-1 / (sampleRate * 0.002)); // 2ms smoothing

    for (let i = 0; i < len; i++) {
      const absL = Math.abs(inL[i]);
      const absR = Math.abs(inR[i]);
      // Stereo-linked max detection — track loudest channel so both
      // channels receive the same transient gain (prevents stereo image shift).
      // Fix M12: previously only L was detected, making right-heavy transients
      // go untreated.
      const stereoLevel = absL > absR ? absL : absR;

      // Fast envelope (follows transients closely)
      if (stereoLevel > this.fastEnvL) {
        this.fastEnvL = fastAttackCoeff * this.fastEnvL + (1 - fastAttackCoeff) * stereoLevel;
      } else {
        this.fastEnvL = fastReleaseCoeff * this.fastEnvL + (1 - fastReleaseCoeff) * stereoLevel;
      }

      // Slow envelope (follows sustain/average)
      if (stereoLevel > this.slowEnvL) {
        this.slowEnvL = slowAttackCoeff * this.slowEnvL + (1 - slowAttackCoeff) * stereoLevel;
      } else {
        this.slowEnvL = slowReleaseCoeff * this.slowEnvL + (1 - slowReleaseCoeff) * stereoLevel;
      }

      // Transient detection: difference between fast and slow envelope
      // Positive = transient phase, Negative/Zero = sustain phase
      const diff = this.fastEnvL - this.slowEnvL * sensitivityLinear;
      const isTransient = diff > 0;

      // Compute per-sample gain
      let sampleGain;
      if (isTransient) {
        // Transient phase: apply attack gain
        const transientAmount = Math.min(diff / (this.slowEnvL + 1e-10), 1); // 0-1 normalized
        sampleGain = 1 + (attackGainTarget - 1) * transientAmount;
      } else {
        // Sustain phase: apply sustain gain
        const sustainAmount = Math.min(Math.abs(diff) / (this.fastEnvL + 1e-10), 1);
        sampleGain = 1 + (sustainGainTarget - 1) * (1 - sustainAmount * 0.5);
      }

      // Smooth the gain to avoid clicks
      this.transientGainSmooth = gainSmoothCoeff * this.transientGainSmooth + (1 - gainSmoothCoeff) * sampleGain;

      // Apply
      const wetL = inL[i] * this.transientGainSmooth;
      const wetR = inR[i] * this.transientGainSmooth;

      outL[i] = (inL[i] * (1 - mixAmount) + wetL * mixAmount) * outputGain;
      outR[i] = (inR[i] * (1 - mixAmount) + wetR * mixAmount) * outputGain;

      // Track transient amount for metering
      if (isTransient && diff > this.peakTransient) {
        this.peakTransient = diff;
      }
    }

    // Report
    this.reportCounter += len;
    if (this.reportCounter >= 256) {
      this.port.postMessage({
        type: 'transientDesigner',
        transientLevel: this.peakTransient,
      });
      this.peakTransient *= 0.8; // decay
      this.reportCounter = 0;
    }

    return true;
  }
}

registerProcessor('transient-designer-processor', TransientDesignerProcessor);
