/**
 * Streaming / delivery loudness targets.
 * Inspired by how release-ready platforms normalize (public LUFS specs),
 * not a copy of any third-party product.
 */

export type StreamingPlatformId =
  | 'spotify'
  | 'apple'
  | 'youtube'
  | 'tiktok'
  | 'competitive'
  | 'dynamic';

export interface StreamingTarget {
  id: StreamingPlatformId;
  name: string;
  /** Integrated LUFS goal for the master */
  lufs: number;
  /** True-peak ceiling (dBTP) */
  truePeak: number;
  /** Short description for UI */
  blurb: string;
}

export const STREAMING_TARGETS: StreamingTarget[] = [
  {
    id: 'spotify',
    name: 'Spotify / YouTube',
    lufs: -14,
    truePeak: -1,
    blurb: 'Balanced streaming loudness after platform normalization',
  },
  {
    id: 'apple',
    name: 'Apple Music',
    lufs: -16,
    truePeak: -1,
    blurb: 'More headroom for Sound Check / open dynamics',
  },
  {
    id: 'tiktok',
    name: 'TikTok / Reels',
    lufs: -12,
    truePeak: -1,
    blurb: 'Punchier for phone speakers & short-form',
  },
  {
    id: 'competitive',
    name: 'Competitive',
    lufs: -11,
    truePeak: -0.8,
    blurb: 'Dense modern club / playlist impact',
  },
  {
    id: 'dynamic',
    name: 'Dynamic',
    lufs: -18,
    truePeak: -1,
    blurb: 'Preserve dynamics — ballads, acoustic, jazz',
  },
];

export function getStreamingTarget(id: StreamingPlatformId | string | undefined): StreamingTarget {
  return STREAMING_TARGETS.find((t) => t.id === id) ?? STREAMING_TARGETS[0];
}
