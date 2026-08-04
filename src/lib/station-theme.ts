/** Shared visual identity for each processing station — console module colors. */

export type StationId =
  | 'assembly'
  | 'automaster'
  | 'automix'
  | 'autolevel'
  | 'beat'
  | 'autotune'
  | 'vocalfix'
  | 'repair'
  | 'delivery';

export interface StationTheme {
  id: StationId;
  short: string;
  title: string;
  subtitle: string;
  color: string;
  glow: string;
  textClass: string;
  led: string;
}

export const STATION_THEMES: Record<StationId, StationTheme> = {
  assembly: {
    id: 'assembly',
    short: 'ASSEMBLY',
    title: 'Assembly Line',
    subtitle: 'Analyze → repair → correct → master',
    color: '#a78bfa',
    glow: 'rgba(167, 139, 250, 0.18)',
    textClass: 'text-violet-400',
    led: '#a78bfa',
  },
  automaster: {
    id: 'automaster',
    short: 'MASTER',
    title: 'Mastering Bay',
    subtitle: 'Stereo polish · loudness · limiter',
    color: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.18)',
    textClass: 'text-amber-400',
    led: '#f59e0b',
  },
  automix: {
    id: 'automix',
    short: 'MIX',
    title: 'Mix Console',
    subtitle: 'Stems · balance · carve · glue',
    color: '#34d399',
    glow: 'rgba(52, 211, 153, 0.16)',
    textClass: 'text-emerald-400',
    led: '#34d399',
  },
  autolevel: {
    id: 'autolevel',
    short: 'LEVEL',
    title: 'Gain Stage',
    subtitle: 'Healthy levels · VU · headroom',
    color: '#38bdf8',
    glow: 'rgba(56, 189, 248, 0.16)',
    textClass: 'text-sky-400',
    led: '#38bdf8',
  },
  beat: {
    id: 'beat',
    short: 'BEAT',
    title: 'Beat Lab',
    subtitle: 'Punch · sub · vocal pocket',
    color: '#fb923c',
    glow: 'rgba(251, 146, 60, 0.16)',
    textClass: 'text-orange-400',
    led: '#fb923c',
  },
  autotune: {
    id: 'autotune',
    short: 'TUNE',
    title: 'Auto-Tune',
    subtitle: 'Natural → T-Pain slider',
    color: '#e879f9',
    glow: 'rgba(232, 121, 249, 0.16)',
    textClass: 'text-fuchsia-400',
    led: '#e879f9',
  },
  vocalfix: {
    id: 'vocalfix',
    short: 'VOCAL',
    title: 'Vocal Suite',
    subtitle: 'Cleanup · chain · polish',
    color: '#fb7185',
    glow: 'rgba(251, 113, 133, 0.16)',
    textClass: 'text-rose-400',
    led: '#fb7185',
  },
  repair: {
    id: 'repair',
    short: 'REPAIR',
    title: 'Cleanup Bay',
    subtitle: 'Denoise · declick · de-hum',
    color: '#2dd4bf',
    glow: 'rgba(45, 212, 191, 0.16)',
    textClass: 'text-teal-400',
    led: '#2dd4bf',
  },
  delivery: {
    id: 'delivery',
    short: 'DELIVER',
    title: 'Delivery Bay',
    subtitle: 'Bounce · stems · metadata',
    color: '#94a3b8',
    glow: 'rgba(148, 163, 184, 0.16)',
    textClass: 'text-slate-300',
    led: '#94a3b8',
  },
};

export const STATION_ORDER: StationId[] = [
  'assembly',
  'automaster',
  'automix',
  'autolevel',
  'beat',
  'autotune',
  'vocalfix',
  'repair',
  'delivery',
];
