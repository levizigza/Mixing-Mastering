# Mixing & Mastering Studio PRO

A fully open-source, browser-based mixing and mastering studio built with Next.js, React, TypeScript, TailwindCSS, and the Web Audio API with custom AudioWorklet DSP processors.

## Features

### Audio Processing (AudioWorklet DSP)
- **Pro Compressor** — RMS/peak detection, lookahead, soft/hard knee, program-dependent release, sidechain HPF
- **True Peak Limiter** — 4x oversampled intersample peak detection, lookahead brickwall
- **Multi-mode Saturation** — Tape, Tube, Transformer, Hard Clip, Soft Clip (4x oversampled, alias-free)
- **4-Band Multiband Dynamics** — Linkwitz-Riley LR4 crossovers, per-band compression
- **Mid/Side Processing** — Stereo width, per-M/S gain, bass mono below threshold
- **Linear-Phase EQ** — FIR convolution via overlap-add FFT, zero phase distortion
- **Dynamic EQ / De-Esser** — 4-band frequency-dependent compression/expansion
- **Sidechain Compressor** — External key input from any stem, with sidechain filter
- **Gate/Expander** — Lookahead, hold, hysteresis, sidechain filter, range control
- **Stereo Imager** — Frequency-dependent width (low/mid/high bands), Haas effect, bass mono

### Metering (ITU-R BS.1770-4)
- Momentary, Short-term, and Integrated LUFS with gating
- 4x oversampled True Peak (dBTP)
- Phase correlation meter
- Stereo vectorscope (Lissajous)
- Per-band multiband level display
- Compressor and limiter gain reduction meters

### Export
- **16-bit, 24-bit, 32-bit float WAV**
- **MP3 320kbps** via lamejs encoder
- **TPDF dithering** or **Noise-shaped dithering** (2nd-order error feedback, pushes noise above 14kHz)

### Workflow
- Multi-stem upload with type detection
- Per-stem 6-band parametric EQ, compressor, saturation, pan, gain
- Master bus: EQ → Multiband → Compressor → Mid/Side → Saturation → Limiter
- Genre-based presets
- Session save/load (JSON)
- Undo/redo (50-step history, Ctrl+Z / Ctrl+Shift+Z)
- A/B bypass with loudness reference
- Sidechain routing between stems
- **Reference track** — load a commercial mix, level-match, A/B compare
- **Loudness targets** — Spotify, Apple Music, YouTube, Tidal, Amazon, SoundCloud, CD, Broadcast (EBU R128)
- **Automation lanes** — time-based parameter curves with point editing
- **Transient designer** — attack/sustain shaping per stem
- **Gate/Expander** — per-stem noise gate with threshold, hold, release
- **Automation playback** — interpolated parameter changes applied in real-time during playback
- **Keyboard shortcuts overlay** — press `?` for full shortcut reference

### UI
- Real-time spectrum analyzer
- Waveform display with seek
- Channel strips with meters
- Stereo scope, phase meter, pro metering panel
- Transient shaper / gate panel per stem
- Keyboard shortcuts help overlay
- Modern dark theme

## Live demo

**https://levizigza.github.io/Mixing-Mastering/**

Deployed automatically to GitHub Pages on every push to `main`.

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server (no basePath)
npm run dev

# Open http://localhost:3000
```

### Build for GitHub Pages (static export)

```bash
# Windows PowerShell
$env:GITHUB_PAGES='true'; npm run build

# macOS / Linux
GITHUB_PAGES=true npm run build
```

Output lands in `out/` and is published by `.github/workflows/deploy-pages.yml`.

In the repo **Settings → Pages**, set Source to **GitHub Actions**.

## Tech Stack
- **Next.js 14** — App router
- **React 18** — UI
- **TypeScript** — Type safety
- **TailwindCSS** — Styling
- **Web Audio API** — Real-time audio
- **AudioWorklet** — Custom DSP processors (14 worklets)
- **lamejs** — MP3 encoding
- **Lucide React** — Icons

## AudioWorklet Processors

All in `public/worklets/`:

| File | Description |
|------|-------------|
| `compressor-processor.js` | Pro compressor with lookahead and soft knee |
| `limiter-processor.js` | True peak limiter with 4x oversampling |
| `saturation-processor.js` | 5-mode saturation with tone control |
| `oversampled-saturation-processor.js` | 4x oversampled alias-free saturation |
| `multiband-processor.js` | 4-band LR4 crossover dynamics |
| `midside-processor.js` | Mid/Side stereo width |
| `metering-processor.js` | BS.1770 LUFS + true peak |
| `linear-phase-eq-processor.js` | FIR linear-phase EQ |
| `dynamic-eq-processor.js` | Dynamic EQ / de-esser |
| `sidechain-compressor-processor.js` | External sidechain compressor |
| `transient-designer-processor.js` | Attack/sustain shaping |
| `gate-expander-processor.js` | Gate/expander with lookahead and hysteresis |
| `stereo-imager-processor.js` | Frequency-dependent stereo width + Haas |

## Browser Support
- Chrome/Edge 66+ (AudioWorklet)
- Firefox 76+ (AudioWorklet)
- Safari 14.1+ (AudioWorklet)
- Graceful fallback to native Web Audio nodes if worklets unavailable

## License

MIT — Free and open source forever.
