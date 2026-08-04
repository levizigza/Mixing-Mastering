/**
 * Linear-Phase EQ AudioWorklet Processor
 *
 * Correct implementation using frequency-sampling FIR design + overlap-save:
 *   1. Build a target magnitude response from RBJ biquad prototypes
 *      (HPF, low shelf, peaking, peaking, high shelf, LPF) sampled on the
 *      DFT grid \u2014 so the visual response matches a minimum-phase EQ.
 *   2. Assign linear (group-delay) phase = exp(-j\u03c9\u00b7(N\u22121)/2) so the IFFT gives
 *      a real, symmetric impulse response of length N centred at (N\u22121)/2.
 *   3. Apply Hann window to reduce stopband ripple.
 *   4. Convolve via overlap-save (block FFT) \u2014 zero phase distortion.
 *
 * Group-delay latency = (N\u22121)/2 samples, reported to host for PDC.
 * Supports 6 bands: HPF, Low Shelf, 2\u00d7 Peaking, High Shelf, LPF.
 */
class LinearPhaseEQProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Band 0: High-pass
      { name: 'freq0', defaultValue: 20, minValue: 10, maxValue: 1000 },
      { name: 'gain0', defaultValue: 0, minValue: -30, maxValue: 0 },
      { name: 'q0', defaultValue: 0.707, minValue: 0.1, maxValue: 10 },
      // Band 1: Low shelf
      { name: 'freq1', defaultValue: 80, minValue: 20, maxValue: 1000 },
      { name: 'gain1', defaultValue: 0, minValue: -18, maxValue: 18 },
      { name: 'q1', defaultValue: 0.707, minValue: 0.1, maxValue: 10 },
      // Band 2: Peaking
      { name: 'freq2', defaultValue: 500, minValue: 50, maxValue: 10000 },
      { name: 'gain2', defaultValue: 0, minValue: -18, maxValue: 18 },
      { name: 'q2', defaultValue: 1.0, minValue: 0.1, maxValue: 20 },
      // Band 3: Peaking
      { name: 'freq3', defaultValue: 2000, minValue: 100, maxValue: 16000 },
      { name: 'gain3', defaultValue: 0, minValue: -18, maxValue: 18 },
      { name: 'q3', defaultValue: 1.0, minValue: 0.1, maxValue: 20 },
      // Band 4: High shelf
      { name: 'freq4', defaultValue: 8000, minValue: 1000, maxValue: 20000 },
      { name: 'gain4', defaultValue: 0, minValue: -18, maxValue: 18 },
      { name: 'q4', defaultValue: 0.707, minValue: 0.1, maxValue: 10 },
      // Band 5: Low-pass
      { name: 'freq5', defaultValue: 20000, minValue: 1000, maxValue: 22000 },
      { name: 'gain5', defaultValue: 0, minValue: -30, maxValue: 0 },
      { name: 'q5', defaultValue: 0.707, minValue: 0.1, maxValue: 10 },
      // Latency compensation (FIR length)
      { name: 'firLength', defaultValue: 4096, minValue: 256, maxValue: 8192 },
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();

    // FIR design parameters.
    //   firLength = 2048 (linear-phase taps, power of 2)
    //   fftSize   = 4096 (>= firLength + blockSize for overlap-save;
    //                     using 4096 gives blockSize up to 2048 per block)
    //   hopSize   = fftSize - firLength + 1 \u2248 2049 samples per IFFT
    //   latency   = (firLength - 1) / 2 samples (group delay of FIR)
    this.firLength = 2048;
    this.fftSize = 4096;
    this.halfFFT = this.fftSize / 2;
    this.hopSize = this.fftSize - this.firLength + 1; // valid output per block

    // FIR kernel in frequency domain (pre-FFT'd)
    this.kernelReal = new Float32Array(this.fftSize);
    this.kernelImag = new Float32Array(this.fftSize);
    // Time-domain kernel (windowed, symmetric)
    this.kernelTime = new Float32Array(this.firLength);

    // Overlap-save input buffers (one FFT-size buffer per channel)
    this.saveBufL = new Float32Array(this.fftSize);
    this.saveBufR = new Float32Array(this.fftSize);
    // Output ring buffers: hold hopSize processed samples waiting to be read
    this.outBufL = new Float32Array(this.hopSize);
    this.outBufR = new Float32Array(this.hopSize);
    this.outReadPos = this.hopSize; // empty to start \u2192 force first process cycle
    this.outWritePos = 0;

    // Input accumulator (collects hopSize fresh samples per cycle)
    this.inAccumL = new Float32Array(this.hopSize);
    this.inAccumR = new Float32Array(this.hopSize);
    this.inAccumPos = 0;

    // Scratch FFT buffers
    this.fftR = new Float32Array(this.fftSize);
    this.fftI = new Float32Array(this.fftSize);

    // Pre-compute bit-reversal table
    this.bitRev = new Uint32Array(this.fftSize);
    const bits = Math.log2(this.fftSize) | 0;
    for (let i = 0; i < this.fftSize; i++) {
      let rev = 0, val = i;
      for (let j = 0; j < bits; j++) {
        rev = (rev << 1) | (val & 1);
        val >>= 1;
      }
      this.bitRev[i] = rev;
    }

    // Pre-compute twiddle factors
    this.twR = new Float32Array(this.halfFFT);
    this.twI = new Float32Array(this.halfFFT);
    for (let i = 0; i < this.halfFFT; i++) {
      const a = -2 * Math.PI * i / this.fftSize;
      this.twR[i] = Math.cos(a);
      this.twI[i] = Math.sin(a);
    }

    // Parameter hash for kernel recomputation
    this.lastParamHash = '';
    this.lastEnabled = true;
    this.lastLatency = 0;
  }

  // In-place radix-2 Cooley-Tukey FFT
  fft(re, im, inverse) {
    const N = this.fftSize;
    for (let i = 0; i < N; i++) {
      const j = this.bitRev[i];
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1;
      const step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let k = 0; k < half; k++) {
          const tIdx = k * step;
          const wr = this.twR[tIdx];
          const wi = inverse ? -this.twI[tIdx] : this.twI[tIdx];
          const e = i + k, o = e + half;
          const tr = wr * re[o] - wi * im[o];
          const ti = wr * im[o] + wi * re[o];
          re[o] = re[e] - tr;
          im[o] = im[e] - ti;
          re[e] = re[e] + tr;
          im[e] = im[e] + ti;
        }
      }
    }
    if (inverse) {
      const inv = 1 / N;
      for (let i = 0; i < N; i++) { re[i] *= inv; im[i] *= inv; }
    }
  }

  // Build target magnitude response on positive-frequency DFT bins.
  // Uses RBJ biquad analog-equivalent magnitudes so the visible frequency
  // response matches the minimum-phase parametric EQ.
  buildMagnitude(parameters, mag) {
    const N = this.fftSize;
    const half = this.halfFFT;
    for (let i = 0; i <= half; i++) mag[i] = 1;
    const sr = sampleRate;

    for (let b = 0; b < 6; b++) {
      const freq = parameters[`freq${b}`]?.[0] ?? 1000;
      const gainDb = parameters[`gain${b}`]?.[0] ?? 0;
      const Q = parameters[`q${b}`]?.[0] ?? 1;

      if (b === 0 && gainDb >= -0.01) continue; // HPF only cuts
      if (b === 5 && gainDb >= -0.01) continue; // LPF only cuts
      if (b >= 1 && b <= 4 && Math.abs(gainDb) < 0.05) continue;

      const w0 = 2 * Math.PI * freq / sr;
      const A = Math.pow(10, gainDb / 40);
      const cosw0 = Math.cos(w0);
      const sinw0 = Math.sin(w0);
      const alpha = sinw0 / (2 * Q);

      // RBJ biquad coefficients (normalized)
      let b0, b1, b2, a0, a1, a2;
      if (b === 0) {
        // HPF
        b0 = (1 + cosw0) / 2; b1 = -(1 + cosw0); b2 = (1 + cosw0) / 2;
        a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      } else if (b === 5) {
        // LPF
        b0 = (1 - cosw0) / 2; b1 = 1 - cosw0; b2 = (1 - cosw0) / 2;
        a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      } else if (b === 1) {
        // Low shelf
        const sq = 2 * Math.sqrt(A) * alpha;
        b0 =    A * ((A + 1) - (A - 1) * cosw0 + sq);
        b1 =  2*A * ((A - 1) - (A + 1) * cosw0);
        b2 =    A * ((A + 1) - (A - 1) * cosw0 - sq);
        a0 =        (A + 1) + (A - 1) * cosw0 + sq;
        a1 =  -2 *  ((A - 1) + (A + 1) * cosw0);
        a2 =        (A + 1) + (A - 1) * cosw0 - sq;
      } else if (b === 4) {
        // High shelf
        const sq = 2 * Math.sqrt(A) * alpha;
        b0 =    A * ((A + 1) + (A - 1) * cosw0 + sq);
        b1 = -2*A * ((A - 1) + (A + 1) * cosw0);
        b2 =    A * ((A + 1) + (A - 1) * cosw0 - sq);
        a0 =        (A + 1) - (A - 1) * cosw0 + sq;
        a1 =   2 *  ((A - 1) - (A + 1) * cosw0);
        a2 =        (A + 1) - (A - 1) * cosw0 - sq;
      } else {
        // Peaking
        b0 = 1 + alpha * A;
        b1 = -2 * cosw0;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cosw0;
        a2 = 1 - alpha / A;
      }

      // Multiply the running magnitude by |H(e^{j\u03c9})| on each bin.
      for (let i = 0; i <= half; i++) {
        const w = Math.PI * i / half; // 0..\u03c0
        const c1 = Math.cos(w), s1 = Math.sin(w);
        const c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
        const nr = b0 + b1 * c1 + b2 * c2;
        const ni = -(b1 * s1 + b2 * s2);
        const dr = a0 + a1 * c1 + a2 * c2;
        const di = -(a1 * s1 + a2 * s2);
        const nm = Math.sqrt(nr * nr + ni * ni);
        const dm = Math.sqrt(dr * dr + di * di);
        if (dm > 1e-20) mag[i] *= nm / dm;
      }
    }
  }

  // Compose linear-phase FIR kernel from target magnitude.
  //   H(k) = M(k) * exp(-j * 2\u03c0k * delay / N)   where delay = (firLength-1)/2
  //   h[n] = IFFT(H) \u2014 real symmetric centred at `delay`
  //   h[n] *= Hann window of length firLength
  buildKernel(parameters) {
    const N = this.fftSize;
    const half = this.halfFFT;
    const L = this.firLength;
    const delay = (L - 1) / 2;

    // Magnitude on positive freqs (reuse fftR as scratch for magnitude)
    const mag = this.fftR;
    this.buildMagnitude(parameters, mag);

    // Fill frequency-domain kernel with linear phase
    const kR = this.kernelReal;
    const kI = this.kernelImag;
    for (let i = 0; i <= half; i++) {
      const phase = -2 * Math.PI * i * delay / N;
      kR[i] = mag[i] * Math.cos(phase);
      kI[i] = mag[i] * Math.sin(phase);
    }
    // Hermitian mirror for real output
    for (let i = half + 1; i < N; i++) {
      kR[i] =  kR[N - i];
      kI[i] = -kI[N - i];
    }

    // IFFT to get time-domain impulse response
    this.fft(kR, kI, true);

    // Extract first L samples (centred around `delay`), apply Hann window
    const h = this.kernelTime;
    for (let n = 0; n < L; n++) {
      const win = 0.5 * (1 - Math.cos(2 * Math.PI * n / (L - 1)));
      h[n] = kR[n] * win;
    }
    // Zero-pad and re-FFT the kernel for use in overlap-save
    for (let n = 0; n < L; n++) { kR[n] = h[n]; kI[n] = 0; }
    for (let n = L; n < N; n++) { kR[n] = 0; kI[n] = 0; }
    this.fft(kR, kI, false);
  }

  // Process one full block via overlap-save convolution.
  //   saveBuf holds previous (firLength-1) samples followed by hopSize fresh.
  //   After FFT \u2192 complex multiply with kernel \u2192 IFFT, discard first
  //   (firLength-1) samples (circular aliasing) and output the remaining hopSize.
  convolveBlock(saveBuf, outBuf) {
    const N = this.fftSize;
    const L = this.firLength;
    const kR = this.kernelReal;
    const kI = this.kernelImag;
    const fR = this.fftR;
    const fI = this.fftI;

    for (let i = 0; i < N; i++) { fR[i] = saveBuf[i]; fI[i] = 0; }
    this.fft(fR, fI, false);

    for (let i = 0; i < N; i++) {
      const ar = fR[i], ai = fI[i];
      const br = kR[i], bi = kI[i];
      fR[i] = ar * br - ai * bi;
      fI[i] = ar * bi + ai * br;
    }

    this.fft(fR, fI, true);

    // Valid output is samples [L-1 .. N-1] \u2192 hopSize values
    for (let i = 0; i < this.hopSize; i++) {
      outBuf[i] = fR[L - 1 + i];
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const enabled = (parameters.enabled?.[0] ?? 1) > 0.5;
    if (!enabled) {
      if (this.lastEnabled) {
        this.lastEnabled = false;
        this.port.postMessage({ type: 'latency', samples: 0 });
      }
      for (let ch = 0; ch < output.length; ch++) {
        if (input[ch]) output[ch].set(input[ch]);
      }
      return true;
    }

    // Recompute kernel if parameters changed
    let hash = '';
    for (let b = 0; b < 6; b++) {
      const f = parameters[`freq${b}`]?.[0] ?? 0;
      const g = parameters[`gain${b}`]?.[0] ?? 0;
      const q = parameters[`q${b}`]?.[0] ?? 1;
      hash += `${f.toFixed(2)}_${g.toFixed(2)}_${q.toFixed(3)}|`;
    }
    if (hash !== this.lastParamHash || !this.lastEnabled) {
      this.buildKernel(parameters);
      this.lastParamHash = hash;
      this.lastEnabled = true;
    }

    // Report latency once per change
    const latency = (this.firLength - 1) / 2;
    if (latency !== this.lastLatency) {
      this.lastLatency = latency;
      this.port.postMessage({ type: 'latency', samples: latency });
    }

    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const blockSize = inL.length;
    const L = this.firLength;
    const HOP = this.hopSize;

    for (let i = 0; i < blockSize; i++) {
      // 1) drain any pending processed samples
      if (this.outReadPos < HOP) {
        outL[i] = this.outBufL[this.outReadPos];
        outR[i] = this.outBufR[this.outReadPos];
        this.outReadPos++;
      } else {
        // accumulator not yet full \u2014 emit silence (only happens during startup)
        outL[i] = 0;
        outR[i] = 0;
      }

      // 2) buffer the fresh input
      this.inAccumL[this.inAccumPos] = inL[i];
      this.inAccumR[this.inAccumPos] = inR[i];
      this.inAccumPos++;

      // 3) when hopSize fresh samples collected \u2192 run convolution
      if (this.inAccumPos >= HOP) {
        this.inAccumPos = 0;
        // Shift saveBuf: move last (L-1) samples to front, append HOP fresh
        this.saveBufL.copyWithin(0, HOP, HOP + (L - 1));
        for (let k = 0; k < HOP; k++) this.saveBufL[(L - 1) + k] = this.inAccumL[k];
        this.saveBufR.copyWithin(0, HOP, HOP + (L - 1));
        for (let k = 0; k < HOP; k++) this.saveBufR[(L - 1) + k] = this.inAccumR[k];

        this.convolveBlock(this.saveBufL, this.outBufL);
        this.convolveBlock(this.saveBufR, this.outBufR);
        this.outReadPos = 0;
      }
    }

    return true;
  }
}

registerProcessor('linear-phase-eq-processor', LinearPhaseEQProcessor);
