import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        studio: {
          bg: '#08080c',
          surface: '#121218',
          panel: '#18181f',
          border: '#2c2c36',
          accent: '#f59e0b',
          'accent-hover': '#fbbf24',
          green: '#22c55e',
          yellow: '#eab308',
          red: '#ef4444',
          orange: '#f97316',
          cyan: '#06b6d4',
          muted: '#6b7280',
          text: '#e8eaed',
          'text-dim': '#9ca3af',
        },
      },
      fontFamily: {
        mono: ['IBM Plex Mono', 'JetBrains Mono', 'monospace'],
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        display: ['Orbitron', 'IBM Plex Sans', 'system-ui', 'sans-serif'],
      },
      animation: {
        'meter-pulse': 'meterPulse 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        meterPulse: {
          '0%': { opacity: '0.8' },
          '100%': { opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
