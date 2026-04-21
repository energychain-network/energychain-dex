import type { Config } from 'tailwindcss';

// EnergyChain DEX trading-desk theme. Dark by default — charts read better on
// a deep neutral. Energy accent (#ffb24d) for primary actions; teal/green for
// "buy" / up-trend, red for "sell" / down-trend.
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      // Add an `xs` breakpoint below the default `sm` (640px) so we can
      // surface mobile-specific layouts (e.g. show short ChainPill labels
      // on phones, full labels on tablets and up).
      screens: {
        xs: '480px',
      },
      colors: {
        ink: {
          950: '#06080d',
          900: '#0a0d14',
          850: '#0e1320',
          800: '#121826',
          700: '#1a2233',
          600: '#252e44',
          500: '#3a4661',
          400: '#5b6584',
          300: '#8a92ad',
          200: '#c4cadb',
          100: '#e5e8f1',
        },
        energy: {
          50: '#fff7ed',
          100: '#ffead0',
          200: '#ffd5a3',
          300: '#ffb96b',
          400: '#ff9b3d',
          500: '#f97316',
          600: '#d65510',
          700: '#a83d0c',
        },
        bull: {
          DEFAULT: '#22c5a4',
          400: '#3ddbb6',
          500: '#22c5a4',
          600: '#0ea888',
          700: '#0a7c66',
        },
        bear: {
          DEFAULT: '#f6477b',
          400: '#fc7099',
          500: '#f6477b',
          600: '#d52e63',
          700: '#a02049',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 24px -8px rgba(255, 155, 61, 0.55)',
        card: '0 1px 0 rgba(255,255,255,0.04) inset, 0 0 0 1px rgba(255,255,255,0.05)',
      },
      backgroundImage: {
        'mesh-1':
          'radial-gradient(ellipse at top, rgba(249,115,22,0.12), transparent 50%), radial-gradient(ellipse at bottom right, rgba(34,197,164,0.10), transparent 50%)',
      },
      keyframes: {
        flashUp:   { '0%': { backgroundColor: 'rgba(34,197,164,0.25)' }, '100%': { backgroundColor: 'transparent' } },
        flashDown: { '0%': { backgroundColor: 'rgba(246,71,123,0.25)' },  '100%': { backgroundColor: 'transparent' } },
        pulseDot:  { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
      },
      animation: {
        flashUp:   'flashUp 1.2s ease-out',
        flashDown: 'flashDown 1.2s ease-out',
        pulseDot:  'pulseDot 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
export default config;
