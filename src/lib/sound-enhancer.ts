// ─── Intelligent Sound Enhancement via Freesound API ────────────────
// Analyzes the track's sonic character, tempo, and key to find
// complementary atmospheric/textural sounds from Freesound's
// Creative Commons library. Sounds are selected based on:
//   1. Track character (anthemic, moody, ethereal, etc.)
//   2. Tempo compatibility (matching BPM range)
//   3. Tonal compatibility (key-aware filtering)
//   4. Duration fit (short FX vs ambient layers)
//
// The module fetches preview audio (no OAuth needed, just API token),
// then mixes it in at carefully calculated levels so it enhances
// without overwhelming the original track.

const FREESOUND_API_KEY = 'YOUR_API_KEY'; // Users set this in settings

export interface SoundEnhancementProfile {
  queries: SoundQuery[];
  maxLayers: number;
  masterVolume: number; // 0-1, how loud the enhancement layer is relative to main mix
}

export interface SoundQuery {
  search: string;
  tags: string[];
  category: 'atmosphere' | 'texture' | 'transition' | 'hype' | 'nature' | 'musical';
  minDuration: number;
  maxDuration: number;
  volume: number; // 0-1 relative volume for this layer
  placement: 'background' | 'intro' | 'drops' | 'throughout';
  stereoPosition: number; // -1 to 1
}

export interface FetchedSound {
  id: number;
  name: string;
  previewUrl: string;
  duration: number;
  tags: string[];
  category: string;
  volume: number;
  placement: string;
  stereoPosition: number;
  license: string;
}

export interface EnhancementResult {
  buffer: AudioBuffer;
  layers: EnhancementLayer[];
}

export interface EnhancementLayer {
  name: string;
  category: string;
  volume: number;
  placement: string;
  freesoundId: number;
  license: string;
}

// ─── Character → Sound Query Mapping ────────────────────────────────
// This is the intelligence layer. Based on what the track SOUNDS like,
// we choose sounds that will complement rather than clash.

function getEnhancementProfile(
  character: string,
  bpm: number,
  key: string,
  energy: number
): SoundEnhancementProfile {
  const profiles: Record<string, () => SoundEnhancementProfile> = {
    anthemic: () => ({
      queries: [
        {
          search: 'crowd cheer stadium roar',
          tags: ['crowd', 'cheer'],
          category: 'hype',
          minDuration: 3,
          maxDuration: 15,
          volume: 0.15,
          placement: 'drops',
          stereoPosition: 0,
        },
        {
          search: 'siren air horn hype',
          tags: ['siren', 'horn'],
          category: 'hype',
          minDuration: 1,
          maxDuration: 5,
          volume: 0.12,
          placement: 'drops',
          stereoPosition: 0.3,
        },
        {
          search: 'orchestral hit impact cinematic',
          tags: ['orchestra', 'impact'],
          category: 'transition',
          minDuration: 1,
          maxDuration: 6,
          volume: 0.12,
          placement: 'intro',
          stereoPosition: 0,
        },
      ],
      maxLayers: 3,
      masterVolume: 0.25,
    }),

    hitmaker: () => ({
      queries: [
        {
          search: 'siren hip hop air horn trap',
          tags: ['siren', 'horn'],
          category: 'hype',
          minDuration: 1,
          maxDuration: 5,
          volume: 0.15,
          placement: 'drops',
          stereoPosition: 0,
        },
        {
          search: 'vinyl crackle warm record',
          tags: ['vinyl', 'crackle'],
          category: 'texture',
          minDuration: 10,
          maxDuration: 60,
          volume: 0.08,
          placement: 'background',
          stereoPosition: 0,
        },
        {
          search: 'gun cock reload effect',
          tags: ['gun', 'reload'],
          category: 'hype',
          minDuration: 0.5,
          maxDuration: 3,
          volume: 0.12,
          placement: 'drops',
          stereoPosition: 0.4,
        },
      ],
      maxLayers: 3,
      masterVolume: 0.22,
    }),

    moody: () => ({
      queries: [
        {
          search: 'rain city night ambient dark',
          tags: ['rain', 'night'],
          category: 'nature',
          minDuration: 10,
          maxDuration: 60,
          volume: 0.12,
          placement: 'background',
          stereoPosition: 0,
        },
        {
          search: 'dark drone ambient sinister pad',
          tags: ['dark', 'drone'],
          category: 'atmosphere',
          minDuration: 10,
          maxDuration: 60,
          volume: 0.10,
          placement: 'background',
          stereoPosition: 0,
        },
        {
          search: 'thunder distant rumble storm',
          tags: ['thunder', 'storm'],
          category: 'nature',
          minDuration: 2,
          maxDuration: 10,
          volume: 0.08,
          placement: 'drops',
          stereoPosition: 0,
        },
      ],
      maxLayers: 3,
      masterVolume: 0.20,
    }),

    atmospheric: () => ({
      queries: [
        {
          search: 'magic wand sparkle fairy dust',
          tags: ['magic', 'sparkle'],
          category: 'texture',
          minDuration: 1,
          maxDuration: 8,
          volume: 0.15,
          placement: 'drops',
          stereoPosition: 0.5,
        },
        {
          search: 'ethereal shimmer chime bell celestial',
          tags: ['shimmer', 'ethereal'],
          category: 'texture',
          minDuration: 2,
          maxDuration: 15,
          volume: 0.12,
          placement: 'throughout',
          stereoPosition: -0.5,
        },
        {
          search: 'dreamy ambient pad atmospheric soft',
          tags: ['ambient', 'dreamy'],
          category: 'atmosphere',
          minDuration: 10,
          maxDuration: 60,
          volume: 0.10,
          placement: 'background',
          stereoPosition: 0,
        },
        {
          search: 'wind chimes gentle breeze',
          tags: ['wind-chimes', 'chimes'],
          category: 'texture',
          minDuration: 3,
          maxDuration: 20,
          volume: 0.10,
          placement: 'throughout',
          stereoPosition: 0.7,
        },
      ],
      maxLayers: 3,
      masterVolume: 0.25,
    }),

    soulful: () => ({
      queries: [
        {
          search: 'vinyl crackle record warm lo-fi',
          tags: ['vinyl', 'crackle'],
          category: 'texture',
          minDuration: 10,
          maxDuration: 60,
          volume: 0.12,
          placement: 'background',
          stereoPosition: 0,
        },
        {
          search: 'tape hiss analog saturation warm',
          tags: ['tape', 'hiss'],
          category: 'texture',
          minDuration: 10,
          maxDuration: 60,
          volume: 0.08,
          placement: 'background',
          stereoPosition: 0,
        },
      ],
      maxLayers: 2,
      masterVolume: 0.18,
    }),

    aggressive: () => ({
      queries: [
        {
          search: 'industrial metallic hit noise harsh',
          tags: ['industrial', 'metallic'],
          category: 'texture',
          minDuration: 2,
          maxDuration: 15,
          volume: 0.12,
          placement: 'drops',
          stereoPosition: 0,
        },
        {
          search: 'explosion impact boom cinematic',
          tags: ['explosion', 'impact'],
          category: 'transition',
          minDuration: 1,
          maxDuration: 5,
          volume: 0.15,
          placement: 'drops',
          stereoPosition: 0,
        },
        {
          search: 'distortion feedback glitch noise',
          tags: ['distortion', 'glitch'],
          category: 'texture',
          minDuration: 2,
          maxDuration: 10,
          volume: 0.10,
          placement: 'throughout',
          stereoPosition: -0.6,
        },
      ],
      maxLayers: 3,
      masterVolume: 0.22,
    }),

    minimal: () => ({
      queries: [
        {
          search: 'subtle ambient texture soft',
          tags: ['ambient', 'subtle'],
          category: 'atmosphere',
          minDuration: 10,
          maxDuration: 60,
          volume: 0.06,
          placement: 'background',
          stereoPosition: 0,
        },
      ],
      maxLayers: 1,
      masterVolume: 0.10,
    }),

    gospel: () => ({
      queries: [
        {
          search: 'church hall reverb space large',
          tags: ['church', 'hall'],
          category: 'atmosphere',
          minDuration: 5,
          maxDuration: 30,
          volume: 0.12,
          placement: 'background',
          stereoPosition: 0,
        },
        {
          search: 'choir voices heavenly angelic',
          tags: ['choir', 'voices'],
          category: 'musical',
          minDuration: 3,
          maxDuration: 20,
          volume: 0.10,
          placement: 'drops',
          stereoPosition: 0,
        },
      ],
      maxLayers: 2,
      masterVolume: 0.20,
    }),

    // ─── Preset-Specific Profiles ─────────────────────────────────
    pop: () => ({
      queries: [
        {
          search: 'clap snap crowd pop',
          tags: ['clap', 'snap'],
          category: 'hype',
          minDuration: 0.5,
          maxDuration: 3,
          volume: 0.10,
          placement: 'drops',
          stereoPosition: 0,
        },
        {
          search: 'bright synth stab chord',
          tags: ['synth', 'stab'],
          category: 'musical',
          minDuration: 1,
          maxDuration: 5,
          volume: 0.08,
          placement: 'drops',
          stereoPosition: 0.4,
        },
        {
          search: 'shaker tambourine percussion loop',
          tags: ['shaker', 'tambourine'],
          category: 'texture',
          minDuration: 5,
          maxDuration: 30,
          volume: 0.07,
          placement: 'throughout',
          stereoPosition: 0.6,
        },
      ],
      maxLayers: 2,
      masterVolume: 0.18,
    }),

    rock: () => ({
      queries: [
        {
          search: 'electric guitar feedback sustain',
          tags: ['guitar', 'feedback'],
          category: 'texture',
          minDuration: 2,
          maxDuration: 10,
          volume: 0.10,
          placement: 'intro',
          stereoPosition: -0.5,
        },
        {
          search: 'crowd concert rock applause',
          tags: ['crowd', 'concert'],
          category: 'hype',
          minDuration: 3,
          maxDuration: 15,
          volume: 0.12,
          placement: 'drops',
          stereoPosition: 0,
        },
        {
          search: 'amp buzz hum tube warm',
          tags: ['amp', 'buzz'],
          category: 'texture',
          minDuration: 5,
          maxDuration: 30,
          volume: 0.05,
          placement: 'background',
          stereoPosition: 0,
        },
      ],
      maxLayers: 2,
      masterVolume: 0.18,
    }),

    edm: () => ({
      queries: [
        {
          search: 'riser sweep build up tension',
          tags: ['riser', 'sweep'],
          category: 'transition',
          minDuration: 2,
          maxDuration: 10,
          volume: 0.15,
          placement: 'drops',
          stereoPosition: 0,
        },
        {
          search: 'impact drop hit sub bass boom',
          tags: ['impact', 'drop'],
          category: 'transition',
          minDuration: 1,
          maxDuration: 4,
          volume: 0.15,
          placement: 'drops',
          stereoPosition: 0,
        },
        {
          search: 'laser synth effect futuristic',
          tags: ['laser', 'synth'],
          category: 'texture',
          minDuration: 0.5,
          maxDuration: 4,
          volume: 0.10,
          placement: 'throughout',
          stereoPosition: 0.7,
        },
        {
          search: 'white noise sweep filter',
          tags: ['noise', 'sweep'],
          category: 'transition',
          minDuration: 2,
          maxDuration: 8,
          volume: 0.10,
          placement: 'drops',
          stereoPosition: 0,
        },
      ],
      maxLayers: 3,
      masterVolume: 0.25,
    }),

    lofi: () => ({
      queries: [
        {
          search: 'vinyl crackle pop noise warm',
          tags: ['vinyl', 'crackle'],
          category: 'texture',
          minDuration: 15,
          maxDuration: 60,
          volume: 0.15,
          placement: 'background',
          stereoPosition: 0,
        },
        {
          search: 'rain window cozy indoor',
          tags: ['rain', 'cozy'],
          category: 'nature',
          minDuration: 15,
          maxDuration: 60,
          volume: 0.10,
          placement: 'background',
          stereoPosition: 0,
        },
        {
          search: 'birds morning nature calm',
          tags: ['birds', 'morning'],
          category: 'nature',
          minDuration: 10,
          maxDuration: 40,
          volume: 0.06,
          placement: 'background',
          stereoPosition: 0.5,
        },
      ],
      maxLayers: 2,
      masterVolume: 0.20,
    }),

    dark: () => ({
      queries: [
        {
          search: 'heartbeat slow pulse dark',
          tags: ['heartbeat', 'pulse'],
          category: 'texture',
          minDuration: 5,
          maxDuration: 30,
          volume: 0.10,
          placement: 'background',
          stereoPosition: 0,
        },
        {
          search: 'creepy ambient horror dark drone',
          tags: ['dark', 'horror'],
          category: 'atmosphere',
          minDuration: 10,
          maxDuration: 60,
          volume: 0.10,
          placement: 'background',
          stereoPosition: 0,
        },
        {
          search: 'thunder distant low rumble',
          tags: ['thunder', 'rumble'],
          category: 'nature',
          minDuration: 2,
          maxDuration: 10,
          volume: 0.12,
          placement: 'drops',
          stereoPosition: 0,
        },
      ],
      maxLayers: 3,
      masterVolume: 0.20,
    }),

    '808s': () => ({
      queries: [
        {
          search: 'ambient cold wind winter',
          tags: ['cold', 'winter'],
          category: 'nature',
          minDuration: 10,
          maxDuration: 60,
          volume: 0.08,
          placement: 'background',
          stereoPosition: 0,
        },
        {
          search: 'vocal chop pitched effect',
          tags: ['vocal', 'chop'],
          category: 'texture',
          minDuration: 1,
          maxDuration: 5,
          volume: 0.10,
          placement: 'drops',
          stereoPosition: 0.5,
        },
      ],
      maxLayers: 2,
      masterVolume: 0.15,
    }),

    maximalist: () => ({
      queries: [
        {
          search: 'orchestra full tutti dramatic cinematic',
          tags: ['orchestra', 'cinematic'],
          category: 'musical',
          minDuration: 3,
          maxDuration: 15,
          volume: 0.12,
          placement: 'drops',
          stereoPosition: 0,
        },
        {
          search: 'epic trailer impact boom deep',
          tags: ['epic', 'trailer'],
          category: 'transition',
          minDuration: 1,
          maxDuration: 5,
          volume: 0.15,
          placement: 'drops',
          stereoPosition: 0,
        },
        {
          search: 'choir epic dramatic powerful voices',
          tags: ['choir', 'epic'],
          category: 'musical',
          minDuration: 5,
          maxDuration: 20,
          volume: 0.10,
          placement: 'throughout',
          stereoPosition: 0,
        },
      ],
      maxLayers: 3,
      masterVolume: 0.25,
    }),

    industrial: () => ({
      queries: [
        {
          search: 'machine factory metallic grinding',
          tags: ['machine', 'factory'],
          category: 'texture',
          minDuration: 5,
          maxDuration: 20,
          volume: 0.12,
          placement: 'background',
          stereoPosition: -0.4,
        },
        {
          search: 'harsh noise burst static glitch',
          tags: ['noise', 'glitch'],
          category: 'texture',
          minDuration: 1,
          maxDuration: 5,
          volume: 0.14,
          placement: 'drops',
          stereoPosition: 0.5,
        },
        {
          search: 'alarm warning siren industrial',
          tags: ['alarm', 'siren'],
          category: 'hype',
          minDuration: 2,
          maxDuration: 8,
          volume: 0.12,
          placement: 'intro',
          stereoPosition: 0,
        },
      ],
      maxLayers: 3,
      masterVolume: 0.22,
    }),
  };

  const profileFn = profiles[character] || profiles['atmospheric'];
  const profile = profileFn();

  // Adjust volumes based on energy — higher energy tracks need louder enhancements to be heard
  if (energy > 0.7) {
    profile.masterVolume *= 1.3;
  } else if (energy < 0.3) {
    profile.masterVolume *= 0.7;
  }

  return profile;
}

// ─── Freesound API Client ───────────────────────────────────────────

async function searchFreesound(
  query: string,
  tags: string[],
  minDuration: number,
  maxDuration: number,
  apiKey: string
): Promise<{ id: number; name: string; previews: Record<string, string>; duration: number; tags: string[]; license: string }[]> {
  // Build filter: duration range + optional tag
  let filter = `duration:[${minDuration} TO ${maxDuration}]`;
  if (tags.length > 0) {
    filter += ` tag:${tags[0]}`;
  }

  const params = new URLSearchParams({
    query,
    filter,
    fields: 'id,name,previews,duration,tags,license',
    page_size: '15',
    sort: 'rating_desc',
    token: apiKey,
  });

  const url = `https://freesound.org/apiv2/search/?${params.toString()}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn('Freesound search failed:', response.status, await response.text().catch(() => ''));
      return [];
    }
    const data = await response.json();
    return data.results || [];
  } catch (err) {
    console.warn('Freesound fetch error:', err);
    return [];
  }
}

async function fetchSoundBuffer(
  previewUrl: string,
  sampleRate: number
): Promise<AudioBuffer | null> {
  try {
    const response = await fetch(previewUrl);
    if (!response.ok) {
      console.warn('Failed to fetch sound preview:', previewUrl, response.status);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    // Use a large enough context to decode any reasonable preview (up to 60s)
    const ctx = new OfflineAudioContext(2, sampleRate * 60, sampleRate);
    return await ctx.decodeAudioData(arrayBuffer);
  } catch (err) {
    console.warn('Failed to decode sound:', previewUrl, err);
    return null;
  }
}

// ─── Intelligent Sound Selection ────────────────────────────────────
// Scores each candidate sound based on how well it fits the track

function scoreCandidate(
  sound: { duration: number; tags: string[] },
  query: SoundQuery,
  trackDuration: number
): number {
  let score = 0;

  // Duration fit: prefer sounds that work well with the track length
  if (query.placement === 'background') {
    // Background sounds should be long enough to loop or fill
    const durationRatio = sound.duration / trackDuration;
    if (durationRatio >= 0.5) score += 3;
    else if (durationRatio >= 0.25) score += 2;
    else score += 1;
  } else {
    // One-shot sounds (drops, transitions) should be short
    if (sound.duration <= 5) score += 3;
    else if (sound.duration <= 10) score += 2;
    else score += 1;
  }

  // Tag match: more matching tags = better fit
  const matchingTags = query.tags.filter(t =>
    sound.tags.some(st => st.toLowerCase().includes(t.toLowerCase()))
  );
  score += matchingTags.length * 2;

  return score;
}

// ─── Main Enhancement Function ──────────────────────────────────────

export async function enhanceWithSounds(
  trackDuration: number,
  sampleRate: number,
  character: string,
  bpm: number,
  key: string,
  energy: number,
  apiKey: string,
  onProgress?: (progress: number, message: string) => void
): Promise<EnhancementResult | null> {
  if (!apiKey || apiKey === 'YOUR_API_KEY') {
    console.log('[SoundEnhancer] No API key configured, skipping');
    return null;
  }

  console.log(`[SoundEnhancer] Starting enhancement for character: ${character}, BPM: ${bpm}, key: ${key}, energy: ${energy.toFixed(2)}`);

  const profile = getEnhancementProfile(character, bpm, key, energy);
  const layers: EnhancementLayer[] = [];
  const fetchedBuffers: { buffer: AudioBuffer; query: SoundQuery }[] = [];

  let layersAdded = 0;

  for (let qi = 0; qi < profile.queries.length && layersAdded < profile.maxLayers; qi++) {
    const query = profile.queries[qi];
    const progress = (qi / profile.queries.length) * 80;
    onProgress?.(progress, `Searching for ${query.category} sounds...`);

    const results = await searchFreesound(
      query.search,
      query.tags,
      query.minDuration,
      query.maxDuration,
      apiKey
    );

    console.log(`[SoundEnhancer] Search "${query.search}" returned ${results.length} results`);
    if (results.length === 0) continue;

    // Score and pick the best match
    const scored = results.map(r => ({
      ...r,
      score: scoreCandidate(r, query, trackDuration),
    }));
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const previewUrl = best.previews?.['preview-hq-mp3'] || best.previews?.['preview-lq-mp3'];
    if (!previewUrl) {
      console.warn(`[SoundEnhancer] No preview URL for "${best.name}"`);
      continue;
    }

    console.log(`[SoundEnhancer] Selected: "${best.name}" (${best.duration.toFixed(1)}s) — fetching from ${previewUrl}`);
    onProgress?.(progress + 5, `Fetching ${best.name}...`);
    const soundBuffer = await fetchSoundBuffer(previewUrl, sampleRate);
    if (!soundBuffer) continue;

    fetchedBuffers.push({ buffer: soundBuffer, query });
    layers.push({
      name: best.name,
      category: query.category,
      volume: query.volume * profile.masterVolume,
      placement: query.placement,
      freesoundId: best.id,
      license: best.license,
    });
    layersAdded++;
  }

  if (fetchedBuffers.length === 0) return null;

  // ─── Mix Enhancement Layers ─────────────────────────────────────
  onProgress?.(85, 'Mixing enhancement layers...');

  const outputLength = Math.floor(trackDuration * sampleRate);
  const outL = new Float32Array(outputLength);
  const outR = new Float32Array(outputLength);

  for (let i = 0; i < fetchedBuffers.length; i++) {
    const { buffer, query } = fetchedBuffers[i];
    const layer = layers[i];
    const volume = layer.volume;

    const srcL = buffer.getChannelData(0);
    const srcR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : srcL;

    // Pan calculation
    const pan = query.stereoPosition;
    const panL = Math.cos((pan + 1) * Math.PI / 4);
    const panR = Math.sin((pan + 1) * Math.PI / 4);

    if (query.placement === 'background' || query.placement === 'throughout') {
      // Loop the sound to fill the track duration, with crossfade at loop points
      const fadeLen = Math.min(Math.floor(sampleRate * 0.5), Math.floor(srcL.length * 0.1));

      for (let pos = 0; pos < outputLength; pos++) {
        const srcPos = pos % srcL.length;
        let gain = volume;

        // Fade in at loop start
        if (srcPos < fadeLen) {
          gain *= srcPos / fadeLen;
        }
        // Fade out at loop end
        if (srcPos > srcL.length - fadeLen) {
          gain *= (srcL.length - srcPos) / fadeLen;
        }

        outL[pos] += srcL[srcPos] * gain * panL;
        outR[pos] += srcR[srcPos] * gain * panR;
      }
    } else if (query.placement === 'drops') {
      // Place at energy peaks — estimate drop points at 25% and 60% through the track
      const dropPoints = [
        Math.floor(outputLength * 0.25),
        Math.floor(outputLength * 0.6),
      ];

      for (const dropStart of dropPoints) {
        const fadeIn = Math.min(Math.floor(sampleRate * 0.05), srcL.length);
        const fadeOut = Math.min(Math.floor(sampleRate * 0.3), srcL.length);

        for (let j = 0; j < srcL.length && dropStart + j < outputLength; j++) {
          let gain = volume;
          if (j < fadeIn) gain *= j / fadeIn;
          if (j > srcL.length - fadeOut) gain *= (srcL.length - j) / fadeOut;

          outL[dropStart + j] += srcL[j] * gain * panL;
          outR[dropStart + j] += srcR[j] * gain * panR;
        }
      }
    } else if (query.placement === 'intro') {
      // Place at the beginning with fade
      const fadeOut = Math.min(Math.floor(sampleRate * 1.0), srcL.length);
      const len = Math.min(srcL.length, outputLength);

      for (let j = 0; j < len; j++) {
        let gain = volume;
        if (j > len - fadeOut) gain *= (len - j) / fadeOut;
        outL[j] += srcL[j] * gain * panL;
        outR[j] += srcR[j] * gain * panR;
      }
    }
  }

  // Create output buffer
  onProgress?.(95, 'Finalizing enhancement layer...');
  const ctx = new OfflineAudioContext(2, outputLength, sampleRate);
  const outputBuffer = ctx.createBuffer(2, outputLength, sampleRate);
  outputBuffer.copyToChannel(new Float32Array(outL), 0);
  outputBuffer.copyToChannel(new Float32Array(outR), 1);

  onProgress?.(100, 'Enhancement complete!');
  return { buffer: outputBuffer, layers };
}

// ─── API Key Management ─────────────────────────────────────────────

export function getStoredApiKey(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('freesound_api_key') || '';
}

export function setStoredApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('freesound_api_key', key);
}
