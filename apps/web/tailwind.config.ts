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
        'surface-canvas': 'hsl(var(--surface-canvas))',
        'surface-raised': 'hsl(var(--surface-raised))',
        'surface-hover': 'hsl(var(--surface-hover))',
        'surface-active': 'hsl(var(--surface-active))',
        'surface-selected': 'hsl(var(--surface-selected))',
        fg: 'hsl(var(--fg))',
        'fg-muted': 'hsl(var(--fg-muted))',
        'fg-subtle': 'hsl(var(--fg-subtle))',
        'text-disabled': 'hsl(var(--text-disabled))',
        border: 'hsl(var(--border))',
        'border-strong': 'hsl(var(--border-strong))',
        ring: 'hsl(var(--ring))',
        brand: {
          DEFAULT: 'hsl(var(--brand))',
          foreground: 'hsl(var(--brand-foreground))',
          soft: 'hsl(var(--brand-soft))',
          hover: 'hsl(var(--brand-hover))',
          50: 'hsl(var(--brand-soft))',
          500: 'hsl(var(--brand))',
          600: 'hsl(var(--brand-hover))',
          700: 'hsl(var(--brand-hover))',
        },
        // 자료 상태 색 (DESIGN.md §2.1)
        status: {
          new: 'hsl(var(--status-new))',
          checkedOut: 'hsl(var(--status-checked-out))',
          checkedIn: 'hsl(var(--status-checked-in))',
          inApproval: 'hsl(var(--status-in-approval))',
          approved: 'hsl(var(--status-approved))',
          rejected: 'hsl(var(--status-rejected))',
          deleted: 'hsl(var(--status-deleted))',
        },
        // semantic
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        danger: 'hsl(var(--danger))',
        info: 'hsl(var(--info))',
        // R36 챗봇 — Dolly 캐릭터 + 패널 톤. 시스템 brand와 분리.
        bot: {
          primary: 'hsl(var(--bot-primary))',
          'primary-deep': 'hsl(var(--bot-primary-deep))',
          soft: 'hsl(var(--bot-soft))',
          accent: 'hsl(var(--bot-accent))',
          faceplate: 'hsl(var(--bot-faceplate))',
          fg: 'hsl(var(--bot-fg))',
          'fg-soft': 'hsl(var(--bot-fg-soft))',
          'on-brand-fg': 'hsl(var(--bot-on-brand-fg))',
        },
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
        // R36 — Dolly 로봇 모션. prefers-reduced-motion에서 globals.css의
        // 글로벌 reset이 모두 정지시킨다.
        'bot-blink': {
          '0%, 92%, 100%': { transform: 'scaleY(1)' },
          '95%, 97%': { transform: 'scaleY(0.1)' },
        },
        'bot-antenna-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        'bot-thinking-dot': {
          '0%, 80%, 100%': { opacity: '0.3', transform: 'translateY(0)' },
          '40%': { opacity: '1', transform: 'translateY(-2px)' },
        },
        'panel-enter': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'bot-blink': 'bot-blink 4s ease-in-out infinite',
        'bot-antenna-pulse': 'bot-antenna-pulse 1.2s ease-in-out infinite',
        'bot-thinking-dot': 'bot-thinking-dot 1.2s ease-in-out infinite',
        'panel-enter': 'panel-enter 220ms cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
export default config;
