/** @type {import('tailwindcss').Config} */
export default {
  content: ['./web/index.html', './web/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#07050D',
        surface: '#0C0817',
        panel: '#120B22',
        deep: '#160B29',
        neon: '#8B35FF',
        electric: '#168CFF',
        ice: '#F5F2FF',
        muted: '#A9A2BA',
      },
      fontFamily: {
        sans: ['Inter', 'Vazirmatn', 'system-ui', 'sans-serif'],
        fa: ['Vazirmatn', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(139,53,255,0.28), 0 18px 60px -24px rgba(139,53,255,0.55)',
        panel: '0 24px 70px -40px rgba(0,0,0,0.95)',
      },
      backgroundImage: {
        'grid-fade':
          'radial-gradient(circle at 50% 0%, rgba(139,53,255,0.16), transparent 60%), radial-gradient(circle at 85% 15%, rgba(22,140,255,0.12), transparent 55%)',
      },
      keyframes: {
        pulseGlow: {
          '0%,100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        pulseGlow: 'pulseGlow 3.5s ease-in-out infinite',
        slideUp: 'slideUp 0.28s ease-out both',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};
