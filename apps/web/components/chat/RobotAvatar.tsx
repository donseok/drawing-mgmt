'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Dolly — R36 chatbot mascot.
 *
 * Inline SVG so we can drive eye / antenna state without per-asset variants.
 * `aria-hidden` because the character is decorative; meaning is always
 * supplied by the surrounding text (panel title, status meta line).
 *
 * `prefers-reduced-motion` is handled by globals.css — we just emit Tailwind
 * `animate-*` classes; the global media query freezes them.
 *
 * Size names (`fab` / `header` / `message` / `hero`) match the design spec
 * §2.5 so the design ↔ code mapping reads 1:1.
 */
export type RobotAvatarSize = 'fab' | 'header' | 'message' | 'hero';
export type RobotAvatarState = 'idle' | 'thinking' | 'speaking' | 'error';
export type RobotAvatarVariant = 'default' | 'on-brand';

const SIZE_PX: Record<RobotAvatarSize, number> = {
  message: 24,
  fab: 28,
  header: 32,
  hero: 80,
};

interface Props {
  size?: RobotAvatarSize;
  state?: RobotAvatarState;
  /**
   * `on-brand` flips body fills to white so the character reads on a brand-blue
   * FAB background. Used for the FAB only (caveat in §2.5 of the design spec).
   */
  variant?: RobotAvatarVariant;
  className?: string;
}

export const RobotAvatar = React.memo(function RobotAvatar({
  size = 'message',
  state = 'idle',
  variant = 'default',
  className,
}: Props) {
  const px = SIZE_PX[size];
  const isOnBrand = variant === 'on-brand';

  // Tone roles.
  const bodyFill = isOnBrand ? 'hsl(var(--bot-on-brand-fg))' : 'hsl(var(--bot-primary))';
  const earFill = isOnBrand
    ? 'hsl(var(--bot-on-brand-fg) / 0.78)'
    : 'hsl(var(--bot-primary-deep))';
  const visorFill = isOnBrand ? 'hsl(var(--bot-primary-deep))' : 'hsl(var(--bot-faceplate))';
  const eyeFill = isOnBrand ? 'hsl(var(--bot-primary))' : 'hsl(var(--bot-soft))';
  const antennaStroke = isOnBrand
    ? 'hsl(var(--bot-on-brand-fg) / 0.7)'
    : 'hsl(var(--bot-fg-soft))';
  const antennaDotFill =
    state === 'error' ? 'hsl(var(--danger))' : 'hsl(var(--bot-accent))';
  const chestFill = isOnBrand ? 'hsl(var(--bot-on-brand-fg) / 0.92)' : 'hsl(var(--brand))';
  const shadowFill = 'hsl(var(--bot-fg) / 0.08)';

  // Eye geometry shifts with state.
  const eyeRadius = state === 'speaking' ? 3 : 2.5;
  const eyeRy =
    state === 'thinking' ? 1 : state === 'error' ? 0.4 : eyeRadius;
  // For thinking/error we render the eye as an ellipse to fake the curve/line.
  const useEllipse = state === 'thinking' || state === 'error';
  // Slight upward shift for the thinking ^^.
  const eyeOffsetY = state === 'thinking' ? -1 : 0;

  // Antenna animation — pulse only on thinking. Speaking flashes once via key.
  const antennaAnim =
    state === 'thinking' ? 'animate-bot-antenna-pulse' : '';
  // Eye blink runs on idle + speaking (but reduce-motion freezes it globally).
  const blinkAnim = state === 'idle' ? 'animate-bot-blink' : '';
  // Speaking flash uses panel-enter as a one-shot opacity bump on the chest.
  const chestSpeakingClass =
    state === 'speaking' ? 'animate-panel-enter' : '';

  return (
    <svg
      role="img"
      aria-hidden="true"
      width={px}
      height={px}
      viewBox="0 0 64 64"
      className={cn('shrink-0', className)}
    >
      {/* Shadow — small, suggestive ground plane. Scale down on small avatars. */}
      {size !== 'message' ? (
        <ellipse cx="32" cy="60" rx="14" ry="1.6" fill={shadowFill} />
      ) : null}

      {/* Antenna — line + dot. */}
      <line
        x1="32"
        y1="4"
        x2="32"
        y2="11"
        stroke={antennaStroke}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle
        cx="32"
        cy="4"
        r="2"
        fill={antennaDotFill}
        className={antennaAnim}
        style={{ transformOrigin: '32px 4px' }}
      />

      {/* Ears (head sides) — sit slightly behind head. */}
      <rect x="10" y="20" width="4" height="8" rx="1.2" fill={earFill} />
      <rect x="50" y="20" width="4" height="8" rx="1.2" fill={earFill} />

      {/* Head body. */}
      <rect x="14" y="11" width="36" height="26" rx="10" ry="10" fill={bodyFill} />

      {/* Visor (face plate). */}
      <rect x="18" y="17" width="28" height="14" rx="6" ry="6" fill={visorFill} />

      {/* Eyes — geometry differs per state. The g wrapper carries the blink
       * animation so both eyes flicker in sync. */}
      <g
        className={blinkAnim}
        style={{ transformOrigin: '32px 24px', transformBox: 'fill-box' }}
        transform={`translate(0 ${eyeOffsetY})`}
      >
        {useEllipse ? (
          <>
            <ellipse cx="26" cy="24" rx={eyeRadius} ry={eyeRy} fill={eyeFill} />
            <ellipse cx="38" cy="24" rx={eyeRadius} ry={eyeRy} fill={eyeFill} />
          </>
        ) : (
          <>
            <circle cx="26" cy="24" r={eyeRadius} fill={eyeFill} />
            <circle cx="38" cy="24" r={eyeRadius} fill={eyeFill} />
          </>
        )}
      </g>

      {/* Body. */}
      <rect x="18" y="38" width="28" height="18" rx="6" ry="6" fill={bodyFill} />

      {/* Chest LED — system brand glow (or muted in error). */}
      <rect
        x="28"
        y="44"
        width="8"
        height="6"
        rx="1.5"
        ry="1.5"
        fill={state === 'error' ? 'hsl(var(--bot-fg-soft))' : chestFill}
        className={chestSpeakingClass}
        // re-key the speaking flash so it replays each transition
        key={state === 'speaking' ? 'speaking' : 'static'}
      />
    </svg>
  );
});
