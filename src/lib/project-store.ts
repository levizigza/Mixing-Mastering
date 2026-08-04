/** IndexedDB persistence for project audio buffers + session meta. */

const DB_NAME = 'mixing-mastering-studio';
const DB_VERSION = 1;
const STORE_BUFFERS = 'buffers';
const STORE_META = 'meta';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BUFFERS)) {
        db.createObjectStore(STORE_BUFFERS);
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export interface StoredBufferPayload {
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  channels: Float32Array[];
}

export async function audioBufferToPayload(buffer: AudioBuffer): Promise<StoredBufferPayload> {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(new Float32Array(buffer.getChannelData(ch)));
  }
  return {
    sampleRate: buffer.sampleRate,
    length: buffer.length,
    numberOfChannels: buffer.numberOfChannels,
    channels,
  };
}

export function payloadToAudioBuffer(payload: StoredBufferPayload): AudioBuffer {
  const ctx = new OfflineAudioContext(
    payload.numberOfChannels,
    payload.length,
    payload.sampleRate
  );
  const buf = ctx.createBuffer(payload.numberOfChannels, payload.length, payload.sampleRate);
  for (let ch = 0; ch < payload.numberOfChannels; ch++) {
    buf.copyToChannel(new Float32Array(payload.channels[ch]), ch);
  }
  return buf;
}

export async function saveAudioBuffer(key: string, buffer: AudioBuffer): Promise<void> {
  const db = await openDb();
  const payload = await audioBufferToPayload(buffer);
  const tx = db.transaction(STORE_BUFFERS, 'readwrite');
  tx.objectStore(STORE_BUFFERS).put(payload, key);
  await txDone(tx);
  db.close();
}

export async function loadAudioBuffer(key: string): Promise<AudioBuffer | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_BUFFERS, 'readonly');
  const req = tx.objectStore(STORE_BUFFERS).get(key);
  const payload = await new Promise<StoredBufferPayload | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  if (!payload) return null;
  return payloadToAudioBuffer(payload);
}

export async function deleteAudioBuffer(key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_BUFFERS, 'readwrite');
  tx.objectStore(STORE_BUFFERS).delete(key);
  await txDone(tx);
  db.close();
}

export async function saveProjectMeta(key: string, meta: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_META, 'readwrite');
  tx.objectStore(STORE_META).put(meta, key);
  await txDone(tx);
  db.close();
}

export async function loadProjectMeta<T>(key: string): Promise<T | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_META, 'readonly');
  const req = tx.objectStore(STORE_META).get(key);
  const result = await new Promise<T | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  return result ?? null;
}

export const PROJECT_META_KEY = 'current-project-v2';
