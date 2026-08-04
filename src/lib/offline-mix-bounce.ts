/** Offline bounce of heuristic stems with Auto Mix processing → stereo buffer. */

import { Stem, StemProcessing, StemType } from '@/types/audio';
import { SeparatedStems } from '@/lib/stem-separator';
import { defaultStemProcessing } from '@/lib/defaults';
import { generateId } from '@/lib/utils';

function cloneProcessing(p: StemProcessing): StemProcessing {
  return {
    ...p,
    eq: p.eq.map((b) => ({ ...b })),
    compressor: { ...p.compressor },
    saturation: { ...p.saturation },
  };
}

/** Build Stem[] from separated buffers for autoMixAndMaster. */
export function stemsFromSeparated(separated: SeparatedStems, trackName: string): Stem[] {
  const entries: { type: StemType; buffer: AudioBuffer; name: string }[] = [
    { type: 'vocals', buffer: separated.vocals, name: `${trackName} Vocals` },
    { type: 'drums', buffer: separated.drums, name: `${trackName} Drums` },
    { type: 'bass', buffer: separated.bass, name: `${trackName} Bass` },
    { type: 'instruments', buffer: separated.instruments, name: `${trackName} Inst` },
  ];
  return entries.map(({ type, buffer, name }) => ({
    id: generateId(),
    name,
    type,
    file: null,
    audioBuffer: buffer,
    processing: cloneProcessing(defaultStemProcessing),
    waveformData: null,
    peakLevel: 0,
    rmsLevel: 0,
  }));
}

async function renderStemChain(
  ctx: OfflineAudioContext,
  buffer: AudioBuffer,
  proc: StemProcessing,
  destination: AudioNode
): Promise<void> {
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  let node: AudioNode = src;
  const safeBands = (proc.eq || []).filter((band) => {
    // OfflineAudioContext is picky; skip bands with invalid freqs
    return Number.isFinite(band.frequency) && band.frequency > 0 && band.frequency < buffer.sampleRate / 2;
  });
  for (const band of safeBands) {
    const f = ctx.createBiquadFilter();
    const t = band.type || 'peaking';
    f.type = t === 'highpass' || t === 'lowpass' || t === 'lowshelf' || t === 'highshelf' || t === 'notch' || t === 'peaking'
      ? t
      : 'peaking';
    f.frequency.value = band.frequency;
    f.Q.value = Math.max(0.1, band.Q || 1);
    f.gain.value = band.gain || 0;
    node.connect(f);
    node = f;
  }

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = proc.compressor.threshold;
  comp.ratio.value = proc.compressor.ratio;
  comp.attack.value = Math.max(0.001, proc.compressor.attack);
  comp.release.value = Math.max(0.01, proc.compressor.release);
  comp.knee.value = proc.compressor.knee;
  node.connect(comp);
  node = comp;

  const makeup = ctx.createGain();
  makeup.gain.value =
    Math.pow(10, (proc.gain + (proc.compressor.makeupGain || 0)) / 20) *
    (proc.mute ? 0 : 1);
  node.connect(makeup);

  const pan = ctx.createStereoPanner();
  pan.pan.value = proc.pan;
  makeup.connect(pan);
  pan.connect(destination);

  src.start(0);
}

/**
 * Sum stems with their processing into a single stereo buffer.
 * Duration = max stem duration.
 */
export async function bounceOfflineMix(
  stems: Stem[],
  settings: Record<string, StemProcessing>,
  onProgress?: (p: number, m: string) => void
): Promise<AudioBuffer> {
  const withAudio = stems.filter((s) => s.audioBuffer && !(settings[s.id]?.mute ?? s.processing.mute));
  if (withAudio.length === 0) {
    throw new Error('No stems to bounce');
  }

  let maxLen = 0;
  let sr = 44100;
  for (const s of withAudio) {
    const b = s.audioBuffer!;
    if (b.length > maxLen) maxLen = b.length;
    sr = b.sampleRate;
  }

  onProgress?.(10, 'Building offline mix...');
  const ctx = new OfflineAudioContext(2, maxLen, sr);
  const bus = ctx.createGain();
  bus.gain.value = 0.85; // headroom for summing
  bus.connect(ctx.destination);

  for (let i = 0; i < withAudio.length; i++) {
    const stem = withAudio[i];
    const proc = settings[stem.id] ?? stem.processing;
    onProgress?.(10 + (i / withAudio.length) * 70, `Rendering ${stem.name}...`);
    await renderStemChain(ctx, stem.audioBuffer!, proc, bus);
  }

  onProgress?.(85, 'Mixing down...');
  const rendered = await ctx.startRendering();
  onProgress?.(100, 'Mix bounce complete');
  return rendered;
}
