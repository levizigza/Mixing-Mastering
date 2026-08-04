/**
 * 4-band multiband dynamics processor AudioWorklet
 * Linkwitz-Riley crossover filters → per-band compressor → recombine
 * Bands: Sub (<100Hz), Low (100-500Hz), Mid (500-4kHz), High (>4kHz)
 */
class MultibandProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Crossover frequencies
      { name: 'crossover1', defaultValue: 100, minValue: 20, maxValue: 500 },
      { name: 'crossover2', defaultValue: 500, minValue: 100, maxValue: 4000 },
      { name: 'crossover3', defaultValue: 4000, minValue: 1000, maxValue: 16000 },
      // Per-band threshold
      { name: 'threshold1', defaultValue: -24, minValue: -60, maxValue: 0 },
      { name: 'threshold2', defaultValue: -24, minValue: -60, maxValue: 0 },
      { name: 'threshold3', defaultValue: -24, minValue: -60, maxValue: 0 },
      { name: 'threshold4', defaultValue: -24, minValue: -60, maxValue: 0 },
      // Per-band ratio
      { name: 'ratio1', defaultValue: 2, minValue: 1, maxValue: 20 },
      { name: 'ratio2', defaultValue: 2, minValue: 1, maxValue: 20 },
      { name: 'ratio3', defaultValue: 2, minValue: 1, maxValue: 20 },
      { name: 'ratio4', defaultValue: 2, minValue: 1, maxValue: 20 },
      // Per-band gain
      { name: 'gain1', defaultValue: 0, minValue: -18, maxValue: 18 },
      { name: 'gain2', defaultValue: 0, minValue: -18, maxValue: 18 },
      { name: 'gain3', defaultValue: 0, minValue: -18, maxValue: 18 },
      { name: 'gain4', defaultValue: 0, minValue: -18, maxValue: 18 },
      // Global
      { name: 'attack', defaultValue: 0.005, minValue: 0.0001, maxValue: 0.5 },
      { name: 'release', defaultValue: 0.1, minValue: 0.005, maxValue: 2.0 },
    ];
  }

  constructor() {
    super();
    // Main crossover filters (3 crossovers). Each is LR4 = 2 cascaded Butterworth biquads.
    this.filters = [];
    for (let i = 0; i < 3; i++) {
      this.filters.push({
        lpL1: this.createBiquadState(), lpL2: this.createBiquadState(),
        lpR1: this.createBiquadState(), lpR2: this.createBiquadState(),
        hpL1: this.createBiquadState(), hpL2: this.createBiquadState(),
        hpR1: this.createBiquadState(), hpR2: this.createBiquadState(),
        lpB: [0, 0, 0], lpA: [0, 0],
        hpB: [0, 0, 0], hpA: [0, 0],
        lastFreq: 0,
      });
    }

    // All-pass phase-compensation filter states (fix C9).
    // Band 1 needs AP(f1) \u2218 AP(f2) to match bands 3/4's group delay.
    // Band 2 needs AP(f2) to match bands 3/4's group delay.
    // Each 4th-order all-pass = LR4_LP + LR4_HP applied to the same input,
    // reusing the main-chain coefficients but with independent filter state.
    this.ap = {
      // b1 \u2192 AP(f1): needs its own LP+HP state through f0 coeffs (\u2026 wait, relabel)
      //   b1 needs AP at f1 (index 1) and AP at f2 (index 2).
      b1f1: this.apState(), b1f2: this.apState(),
      b2f2: this.apState(),
    };

    // Per-band envelope followers (gain reduction in dB, positive value)
    this.envelopes = [0, 0, 0, 0];

    // Band level reporting
    this.bandLevels = [0, 0, 0, 0];
    this.bandGR = [0, 0, 0, 0];
    this.reportCounter = 0;
  }

  apState() {
    // Per-AP state: independent LP and HP filter states, L and R channels,
    // each with two cascaded biquad stages (LR4 = 2\u00d7 BW2).
    return {
      lpL1: this.createBiquadState(), lpL2: this.createBiquadState(),
      lpR1: this.createBiquadState(), lpR2: this.createBiquadState(),
      hpL1: this.createBiquadState(), hpL2: this.createBiquadState(),
      hpR1: this.createBiquadState(), hpR2: this.createBiquadState(),
    };
  }

  createBiquadState() {
    return { x1: 0, x2: 0, y1: 0, y2: 0 };
  }

  computeButterworth(freq, type) {
    const w0 = 2 * Math.PI * freq / sampleRate;
    const cos_w0 = Math.cos(w0);
    const sin_w0 = Math.sin(w0);
    const alpha = sin_w0 / (2 * 0.7071); // Q = 0.7071 for Butterworth

    let b0, b1, b2, a0, a1, a2;

    if (type === 'lp') {
      b0 = (1 - cos_w0) / 2;
      b1 = 1 - cos_w0;
      b2 = (1 - cos_w0) / 2;
    } else {
      b0 = (1 + cos_w0) / 2;
      b1 = -(1 + cos_w0);
      b2 = (1 + cos_w0) / 2;
    }
    a0 = 1 + alpha;
    a1 = -2 * cos_w0;
    a2 = 1 - alpha;

    return {
      b: [b0 / a0, b1 / a0, b2 / a0],
      a: [a1 / a0, a2 / a0],
    };
  }

  updateFilterCoeffs(filterIdx, freq) {
    const f = this.filters[filterIdx];
    if (Math.abs(f.lastFreq - freq) < 0.1) return;
    f.lastFreq = freq;

    const lp = this.computeButterworth(freq, 'lp');
    const hp = this.computeButterworth(freq, 'hp');
    f.lpB = lp.b;
    f.lpA = lp.a;
    f.hpB = hp.b;
    f.hpA = hp.a;
  }

  biquad(x, state, b, a) {
    let y = b[0] * x + b[1] * state.x1 + b[2] * state.x2 - a[0] * state.y1 - a[1] * state.y2;
    // Denormal guard (M15)
    if (y > -1e-30 && y < 1e-30) y = 0;
    state.x2 = state.x1;
    state.x1 = x;
    state.y2 = state.y1;
    state.y1 = y;
    return y;
  }

  // Linkwitz-Riley 4th order = cascade of two Butterworth 2nd order
  lr4LP(x, s1, s2, b, a) {
    return this.biquad(this.biquad(x, s1, b, a), s2, b, a);
  }

  lr4HP(x, s1, s2, b, a) {
    return this.biquad(this.biquad(x, s1, b, a), s2, b, a);
  }

  // 4th-order all-pass = LR4_LP(x) + LR4_HP(x). Flat magnitude, group delay
  // matching an LR4 split. Used to phase-compensate bands that otherwise
  // bypass downstream crossover splits (fix C9).
  //   `st` holds the per-path lp/hp states for L and R; `ch` = 'L' | 'R'.
  apStereo(x, st, ch, lpB, lpA, hpB, hpA) {
    const s1lp = ch === 'L' ? st.lpL1 : st.lpR1;
    const s2lp = ch === 'L' ? st.lpL2 : st.lpR2;
    const s1hp = ch === 'L' ? st.hpL1 : st.hpR1;
    const s2hp = ch === 'L' ? st.hpL2 : st.hpR2;
    const lp = this.lr4LP(x, s1lp, s2lp, lpB, lpA);
    const hp = this.lr4HP(x, s1hp, s2hp, hpB, hpA);
    return lp + hp;
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

    const cx1 = parameters.crossover1[0] ?? 100;
    const cx2 = parameters.crossover2[0] ?? 500;
    const cx3 = parameters.crossover3[0] ?? 4000;

    this.updateFilterCoeffs(0, cx1);
    this.updateFilterCoeffs(1, cx2);
    this.updateFilterCoeffs(2, cx3);

    const thresholds = [
      parameters.threshold1[0] ?? -24,
      parameters.threshold2[0] ?? -24,
      parameters.threshold3[0] ?? -24,
      parameters.threshold4[0] ?? -24,
    ];
    const ratios = [
      parameters.ratio1[0] ?? 2,
      parameters.ratio2[0] ?? 2,
      parameters.ratio3[0] ?? 2,
      parameters.ratio4[0] ?? 2,
    ];
    const gains = [
      Math.pow(10, (parameters.gain1[0] ?? 0) / 20),
      Math.pow(10, (parameters.gain2[0] ?? 0) / 20),
      Math.pow(10, (parameters.gain3[0] ?? 0) / 20),
      Math.pow(10, (parameters.gain4[0] ?? 0) / 20),
    ];

    const attack = parameters.attack[0] ?? 0.005;
    const release = parameters.release[0] ?? 0.1;
    const attackCoeff = Math.exp(-1 / (sampleRate * attack));
    const releaseCoeff = Math.exp(-1 / (sampleRate * release));

    const f0 = this.filters[0];
    const f1 = this.filters[1];
    const f2 = this.filters[2];

    const ap_b1f1 = this.ap.b1f1;
    const ap_b1f2 = this.ap.b1f2;
    const ap_b2f2 = this.ap.b2f2;

    for (let i = 0; i < len; i++) {
      const sL = inL[i];
      const sR = inR[i];

      // ---- Crossover tree (serial cascade) ----
      // Band 1 (sub): LR4 LP @ cx1
      let b1L = this.lr4LP(sL, f0.lpL1, f0.lpL2, f0.lpB, f0.lpA);
      let b1R = this.lr4LP(sR, f0.lpR1, f0.lpR2, f0.lpB, f0.lpA);
      // Residual above cx1
      const hp1L = this.lr4HP(sL, f0.hpL1, f0.hpL2, f0.hpB, f0.hpA);
      const hp1R = this.lr4HP(sR, f0.hpR1, f0.hpR2, f0.hpB, f0.hpA);
      // Band 2 (low): LR4 LP @ cx2 of residual
      let b2L = this.lr4LP(hp1L, f1.lpL1, f1.lpL2, f1.lpB, f1.lpA);
      let b2R = this.lr4LP(hp1R, f1.lpR1, f1.lpR2, f1.lpB, f1.lpA);
      // Residual above cx2
      const hp2L = this.lr4HP(hp1L, f1.hpL1, f1.hpL2, f1.hpB, f1.hpA);
      const hp2R = this.lr4HP(hp1R, f1.hpR1, f1.hpR2, f1.hpB, f1.hpA);
      // Band 3 (mid): LR4 LP @ cx3
      const b3L = this.lr4LP(hp2L, f2.lpL1, f2.lpL2, f2.lpB, f2.lpA);
      const b3R = this.lr4LP(hp2R, f2.lpR1, f2.lpR2, f2.lpB, f2.lpA);
      // Band 4 (high): LR4 HP @ cx3
      const b4L = this.lr4HP(hp2L, f2.hpL1, f2.hpL2, f2.hpB, f2.hpA);
      const b4R = this.lr4HP(hp2R, f2.hpR1, f2.hpR2, f2.hpB, f2.hpA);

      // ---- All-pass phase compensation (fix C9) ----
      // Band 1 must pass through AP(cx2) \u2218 AP(cx3) to match bands 3/4 GD.
      b1L = this.apStereo(b1L, ap_b1f1, 'L', f1.lpB, f1.lpA, f1.hpB, f1.hpA);
      b1R = this.apStereo(b1R, ap_b1f1, 'R', f1.lpB, f1.lpA, f1.hpB, f1.hpA);
      b1L = this.apStereo(b1L, ap_b1f2, 'L', f2.lpB, f2.lpA, f2.hpB, f2.hpA);
      b1R = this.apStereo(b1R, ap_b1f2, 'R', f2.lpB, f2.lpA, f2.hpB, f2.hpA);
      // Band 2 must pass through AP(cx3) to match bands 3/4 GD.
      b2L = this.apStereo(b2L, ap_b2f2, 'L', f2.lpB, f2.lpA, f2.hpB, f2.hpA);
      b2R = this.apStereo(b2R, ap_b2f2, 'R', f2.lpB, f2.lpA, f2.hpB, f2.hpA);

      // ---- Per-band level detection (stereo-linked max) + envelope ----
      const levels = [
        Math.max(Math.abs(b1L), Math.abs(b1R)),
        Math.max(Math.abs(b2L), Math.abs(b2R)),
        Math.max(Math.abs(b3L), Math.abs(b3R)),
        Math.max(Math.abs(b4L), Math.abs(b4R)),
      ];

      for (let bi = 0; bi < 4; bi++) {
        const level = levels[bi];
        const levelDb = level > 1e-10 ? 20 * Math.log10(level) : -120;
        let grDb = 0;
        if (levelDb > thresholds[bi]) {
          grDb = (levelDb - thresholds[bi]) * (1 - 1 / ratios[bi]);
        }
        if (grDb > this.envelopes[bi]) {
          this.envelopes[bi] = attackCoeff * this.envelopes[bi] + (1 - attackCoeff) * grDb;
        } else {
          this.envelopes[bi] = releaseCoeff * this.envelopes[bi] + (1 - releaseCoeff) * grDb;
        }
        if (this.envelopes[bi] > this.bandGR[bi]) this.bandGR[bi] = this.envelopes[bi];
        if (level > this.bandLevels[bi]) this.bandLevels[bi] = level;
      }

      // ---- Apply compression gain + makeup, then recombine ----
      const gain1 = Math.pow(10, -this.envelopes[0] / 20) * gains[0];
      const gain2 = Math.pow(10, -this.envelopes[1] / 20) * gains[1];
      const gain3 = Math.pow(10, -this.envelopes[2] / 20) * gains[2];
      const gain4 = Math.pow(10, -this.envelopes[3] / 20) * gains[3];

      outL[i] = b1L * gain1 + b2L * gain2 + b3L * gain3 + b4L * gain4;
      outR[i] = b1R * gain1 + b2R * gain2 + b3R * gain3 + b4R * gain4;
    }

    // Report
    this.reportCounter += len;
    if (this.reportCounter >= 256) {
      this.port.postMessage({
        type: 'bands',
        levels: [...this.bandLevels],
        gainReduction: [...this.bandGR],
      });
      this.bandLevels = [0, 0, 0, 0];
      this.bandGR = [0, 0, 0, 0];
      this.reportCounter = 0;
    }

    return true;
  }
}

registerProcessor('multiband-processor', MultibandProcessor);
