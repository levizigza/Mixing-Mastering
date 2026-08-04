/**
 * Stereo Imager AudioWorklet Processor
 * 
 * Frequency-dependent stereo width control:
 * - Split signal into low/mid/high bands using crossover filters
 * - Apply independent width control per band
 * - Low frequencies typically narrowed for mono compatibility
 * - High frequencies widened for air and space
 * 
 * Also provides:
 * - Haas effect (micro-delay based widening)
 * - Correlation-safe processing
 * - Bass mono below configurable frequency
 */
class StereoImagerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'lowWidth', defaultValue: 0.5, minValue: 0, maxValue: 2 },    // <crossLow
      { name: 'midWidth', defaultValue: 1.0, minValue: 0, maxValue: 2 },    // crossLow-crossHigh
      { name: 'highWidth', defaultValue: 1.3, minValue: 0, maxValue: 2 },   // >crossHigh
      { name: 'crossLow', defaultValue: 200, minValue: 50, maxValue: 1000 },
      { name: 'crossHigh', defaultValue: 4000, minValue: 1000, maxValue: 16000 },
      { name: 'bassMonoFreq', defaultValue: 80, minValue: 0, maxValue: 300 },
      { name: 'haasDelay', defaultValue: 0, minValue: 0, maxValue: 30 },    // ms, 0=off
      { name: 'haasAmount', defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'globalWidth', defaultValue: 1.0, minValue: 0, maxValue: 2 },
      { name: 'mix', defaultValue: 1.0, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    // LR4 crossover filter states: each LR4 = 2 cascaded BW2 biquads.
    //   f1 = crossLow  (low/mid boundary)
    //   f2 = crossHigh (mid/high boundary)
    // Per crossover we need L and R, LP and HP, two cascaded stages.
    const mk = () => ({ x1: 0, x2: 0, y1: 0, y2: 0 });
    this.x = {
      // Crossover at f1
      f1: {
        lpL1: mk(), lpL2: mk(), lpR1: mk(), lpR2: mk(),
        hpL1: mk(), hpL2: mk(), hpR1: mk(), hpR2: mk(),
      },
      // Crossover at f2
      f2: {
        lpL1: mk(), lpL2: mk(), lpR1: mk(), lpR2: mk(),
        hpL1: mk(), hpL2: mk(), hpR1: mk(), hpR2: mk(),
      },
      // All-pass compensator at f2 applied to low band (phase match fix C11)
      ap_low_f2: {
        lpL1: mk(), lpL2: mk(), lpR1: mk(), lpR2: mk(),
        hpL1: mk(), hpL2: mk(), hpR1: mk(), hpR2: mk(),
      },
    };

    // Haas delay buffer (46 ms @ 44.1 kHz = 2048)
    this.haasBuffer = new Float32Array(2048);
    this.haasWriteIdx = 0;

    // Cached crossover coefficients
    this.lastCrossLow = 0;
    this.lastCrossHigh = 0;
    this.coeffF1 = null; // { lpB, lpA, hpB, hpA }
    this.coeffF2 = null;
  }

  // Compute LR4 crossover coefficients at `freq` \u2014 returns {lpB,lpA,hpB,hpA}
  // where each is normalized (a0=1) for one Butterworth 2nd-order section.
  // LR4 = two of these cascaded.
  computeLR4Coeffs(freq) {
    const w0 = 2 * Math.PI * freq / sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * 0.7071); // Butterworth Q
    const a0 = 1 + alpha;
    // LP
    const lpB = [(1 - cosW0) / 2 / a0, (1 - cosW0) / a0, (1 - cosW0) / 2 / a0];
    // HP
    const hpB = [(1 + cosW0) / 2 / a0, -(1 + cosW0) / a0, (1 + cosW0) / 2 / a0];
    const A = [(-2 * cosW0) / a0, (1 - alpha) / a0];
    return { lpB, lpA: A, hpB, hpA: A };
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

  // LR4 = 2 cascaded BW2
  lr4(x, s1, s2, b, a) {
    return this.biquad(this.biquad(x, s1, b, a), s2, b, a);
  }

  // 4th-order all-pass via LR4_LP + LR4_HP on same input
  apLR4(x, lpS1, lpS2, hpS1, hpS2, lpB, lpA, hpB, hpA) {
    const lp = this.lr4(x, lpS1, lpS2, lpB, lpA);
    const hp = this.lr4(x, hpS1, hpS2, hpB, hpA);
    return lp + hp;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !input[1]) {
      // Mono or no input — pass through
      if (input && input[0]) {
        output[0].set(input[0]);
        if (output[1]) output[1].set(input[1] || input[0]);
      }
      return true;
    }

    const inL = input[0];
    const inR = input[1];
    const outL = output[0];
    const outR = output[1];
    const len = inL.length;

    const lowWidth = parameters.lowWidth[0] ?? 0.5;
    const midWidth = parameters.midWidth[0] ?? 1.0;
    const highWidth = parameters.highWidth[0] ?? 1.3;
    const crossLow = parameters.crossLow[0] ?? 200;
    const crossHigh = parameters.crossHigh[0] ?? 4000;
    const haasDelay = parameters.haasDelay[0] ?? 0;
    const haasAmount = parameters.haasAmount[0] ?? 0.3;
    const globalWidth = parameters.globalWidth[0] ?? 1.0;
    const mix = parameters.mix[0] ?? 1.0;

    // Update crossover coefficients on change
    if (crossLow !== this.lastCrossLow || !this.coeffF1) {
      this.coeffF1 = this.computeLR4Coeffs(crossLow);
      this.lastCrossLow = crossLow;
    }
    if (crossHigh !== this.lastCrossHigh || !this.coeffF2) {
      this.coeffF2 = this.computeLR4Coeffs(crossHigh);
      this.lastCrossHigh = crossHigh;
    }

    const c1 = this.coeffF1;
    const c2 = this.coeffF2;
    const f1 = this.x.f1;
    const f2 = this.x.f2;
    const apl = this.x.ap_low_f2;

    const haasSamples = Math.min(Math.round(haasDelay * sampleRate / 1000), 2047);

    for (let i = 0; i < len; i++) {
      const L = inL[i];
      const R = inR[i];

      // --- Proper LR4 3-band split with phase compensation (fix C11) ---
      // Split at f1 \u2192 low + rest
      let lowL = this.lr4(L, f1.lpL1, f1.lpL2, c1.lpB, c1.lpA);
      let lowR = this.lr4(R, f1.lpR1, f1.lpR2, c1.lpB, c1.lpA);
      const restL = this.lr4(L, f1.hpL1, f1.hpL2, c1.hpB, c1.hpA);
      const restR = this.lr4(R, f1.hpR1, f1.hpR2, c1.hpB, c1.hpA);
      // Split rest at f2 \u2192 mid + high
      const midL = this.lr4(restL, f2.lpL1, f2.lpL2, c2.lpB, c2.lpA);
      const midR = this.lr4(restR, f2.lpR1, f2.lpR2, c2.lpB, c2.lpA);
      const highL = this.lr4(restL, f2.hpL1, f2.hpL2, c2.hpB, c2.hpA);
      const highR = this.lr4(restR, f2.hpR1, f2.hpR2, c2.hpB, c2.hpA);
      // Low band must pass through AP(f2) to match mid/high group delay.
      lowL = this.apLR4(lowL, apl.lpL1, apl.lpL2, apl.hpL1, apl.hpL2,
                        c2.lpB, c2.lpA, c2.hpB, c2.hpA);
      lowR = this.apLR4(lowR, apl.lpR1, apl.lpR2, apl.hpR1, apl.hpR2,
                        c2.lpB, c2.lpA, c2.hpB, c2.hpA);

      // --- Per-band M/S width ---
      const lowM = (lowL + lowR) * 0.5, lowS = (lowL - lowR) * 0.5;
      const midM = (midL + midR) * 0.5, midS = (midL - midR) * 0.5;
      const highM = (highL + highR) * 0.5, highS = (highL - highR) * 0.5;
      const wLowL = lowM + lowS * lowWidth,   wLowR = lowM - lowS * lowWidth;
      const wMidL = midM + midS * midWidth,   wMidR = midM - midS * midWidth;
      const wHighL = highM + highS * highWidth, wHighR = highM - highS * highWidth;

      // Recombine
      let procL = wLowL + wMidL + wHighL;
      let procR = wLowR + wMidR + wHighR;

      // Global width
      const gM = (procL + procR) * 0.5;
      const gS = (procL - procR) * 0.5;
      procL = gM + gS * globalWidth;
      procR = gM - gS * globalWidth;

      // Haas effect (delayed copy of R blended into L)
      if (haasSamples > 0) {
        this.haasBuffer[this.haasWriteIdx] = procR;
        const readIdx = (this.haasWriteIdx - haasSamples + 2048) % 2048;
        const delayed = this.haasBuffer[readIdx];
        procL = procL + delayed * haasAmount;
        this.haasWriteIdx = (this.haasWriteIdx + 1) % 2048;
      }

      outL[i] = L * (1 - mix) + procL * mix;
      outR[i] = R * (1 - mix) + procR * mix;
    }

    return true;
  }
}

registerProcessor('stereo-imager-processor', StereoImagerProcessor);
