import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        sans: ['Pretendard Variable', 'Pretendard', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'D2Coding', 'ui-monospace', 'monospace'],
      },
      colors: {
        bg: 'hsl(var(--bg))',
        'bg-subtle': 'hsl(var(--bg-subtle))',
        'bg-muted': 'hsl(var(--bg-muted))',
        fg: 'hsl(var(--fg))',
        'fg-muted': 'hsl(var(--fg-muted))',
        'fg-subtle': 'hsl(var(--fg-subtle))',
        border: 'hsl(var(--border))',
        'border-strong': 'hsl(var(--border-strong))',
        ring: 'hsl(var(--ring))',
        brand: {
          DEFAULT: 'hsl(var(--brand))',
          foreground: 'hsl(var(--brand-foreground))',
          50: 'hsl(214 100% 97%)',
          500: 'hsl(221 83% 53%)',
          600: 'hsl(221 83% 45%)',
          700: 'hsl(221 83% 38%)',
        },
        // 자료 상태 색 (DESIGN.md §2.1)
        status: {
          new: 'hsl(215 14% 47%)',
          checkedOut: 'hsl(38 92% 50%)',
          checkedIn: 'hsl(199 89% 48%)',
          inApproval: 'hsl(258 90% 66%)',
          approved: 'hsl(160 84% 39%)',
          rejected: 'hsl(347 77% 50%)',
          deleted: 'hsl(25 5% 45%)',
        },
        // semantic
        success: 'hsl(160 84% 39%)',
        warning: 'hsl(38 92% 50%)',
        danger: 'hsl(347 77% 50%)',
        info: 'hsl(199 89% 48%)',
      },
      borderRadius: {
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.25rem',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
export default config;
