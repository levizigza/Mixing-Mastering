/**
 * Encode an already-rendered AudioBuffer to MP3/WAV without re-running
 * OfflineAudioContext / worklet chains. Critical for long real-world tracks
 * in the Assembly Line (avoids a second multi-minute render that freezes the tab).
 */

async function yieldToUI() {
  await new Promise<void>((r) => setTimeout(r, 0));
}

function floatTo16(sample: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
}

/** WAV (16-bit PCM) from an AudioBuffer — no DSP re-render. */
export function encodeBufferToWAV(buffer: AudioBuffer): Blob {
  const numChannels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const L = buffer.getChannelData(0);
  const R = numChannels > 1 ? buffer.getChannelData(1) : L;
  let offset = 44;
  for (let i = 0; i < length; i++) {
    view.setInt16(offset, floatTo16(L[i]), true);
    offset += 2;
    if (numChannels > 1) {
      view.setInt16(offset, floatTo16(R[i]), true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Encode AudioBuffer → MP3 via lamejs.
 * Yields periodically so the UI stays responsive on multi-minute tracks.
 */
export async function encodeBufferToMP3(
  buffer: AudioBuffer,
  kbps: number = 320,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  onProgress?.(2);
  await yieldToUI();

  // @ts-ignore — dynamic import to avoid webpack static analysis issues
  const importFn = new Function('m', 'return import(m)');
  const lamejs = await importFn(/* webpackIgnore: true */ 'lamejs').catch(() => null);
  if (!lamejs) {
    throw new Error('lamejs not available');
  }

  const sampleRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels >= 2 ? 2 : 1;
  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
  const mp3Data: Int8Array[] = [];

  const left = buffer.getChannelData(0);
  const right = channels > 1 ? buffer.getChannelData(1) : left;
  const blockSize = 1152;
  const yieldEvery = Math.max(1, Math.floor((sampleRate * 0.4) / blockSize)); // ~400 ms

  onProgress?.(5);
  let blocks = 0;

  for (let i = 0; i < left.length; i += blockSize) {
    const n = Math.min(blockSize, left.length - i);
    const leftChunk = new Int16Array(n);
    const rightChunk = new Int16Array(n);

    for (let j = 0; j < n; j++) {
      leftChunk[j] = floatTo16(left[i + j]);
      rightChunk[j] = floatTo16(right[i + j]);
    }

    const mp3buf =
      channels > 1
        ? mp3encoder.encodeBuffer(leftChunk, rightChunk)
        : mp3encoder.encodeBuffer(leftChunk);
    if (mp3buf.length > 0) mp3Data.push(new Int8Array(mp3buf));

    blocks++;
    if (blocks % yieldEvery === 0) {
      onProgress?.(5 + Math.round((i / left.length) * 90));
      await yieldToUI();
    }
  }

  const finalBuf = mp3encoder.flush();
  if (finalBuf.length > 0) mp3Data.push(new Int8Array(finalBuf));

  onProgress?.(98);
  await yieldToUI();

  const totalLength = mp3Data.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of mp3Data) {
    result.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), offset);
    offset += chunk.length;
  }

  onProgress?.(100);
  return new Blob([result], { type: 'audio/mpeg' });
}
