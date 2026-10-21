import type React from 'react';
import { Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { color, display, text } from '../theme';

const enter = Easing.bezier(0.16, 1, 0.3, 1);

/** Fade + rise in at `delay` seconds; fade out over the last `outAt`..end if given. */
const useReveal = (delay: number, outAt?: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const opacity = Math.min(
    interpolate(t, [delay, delay + 0.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: enter }),
    outAt === undefined ? 1 : interpolate(t, [outAt, outAt + 0.3], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  );
  const y = interpolate(t, [delay, delay + 0.6], [28, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: enter });
  return { opacity, translate: `0px ${y}px` };
};

type Props = {
  step?: string;
  title: string;
  body?: React.ReactNode;
  /** Seconds after the scene starts. */
  delay?: number;
  /** Seconds after the scene starts when this caption fades out (for captions that change mid-scene). */
  outAt?: number;
  width?: number;
  align?: 'left' | 'center';
  style?: React.CSSProperties;
};

/** Step label, headline and one supporting line, staggered ~100ms apart. */
export const Caption: React.FC<Props> = ({ step, title, body, delay = 0.15, outAt, width = 600, align = 'left', style }) => {
  const stepStyle = useReveal(delay, outAt);
  const titleStyle = useReveal(delay + 0.1, outAt);
  const bodyStyle = useReveal(delay + 0.2, outAt);
  return (
    <div style={{ width, textAlign: align, ...style }}>
      {step && (
        <Interactive.Div
          name="Step"
          style={{
            ...stepStyle,
            display: 'inline-block',
            marginBottom: 28,
            padding: '10px 22px',
            borderRadius: 999,
            background: 'rgba(244, 162, 59, 0.14)',
            color: color.accent,
            fontFamily: text,
            fontWeight: 700,
            fontSize: 26,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          {step}
        </Interactive.Div>
      )}
      <Interactive.Div
        name="Headline"
        style={{
          ...titleStyle,
          fontFamily: display,
          fontWeight: 800,
          fontSize: 88,
          lineHeight: 1.02,
          letterSpacing: '-0.025em',
          color: color.text,
          textWrap: 'balance',
        }}
      >
        {title}
      </Interactive.Div>
      {body && (
        <Interactive.Div
          name="Body"
          style={{
            ...bodyStyle,
            marginTop: 30,
            fontFamily: text,
            fontWeight: 400,
            fontSize: 44,
            lineHeight: 1.3,
            color: color.secondary,
            textWrap: 'pretty',
          }}
        >
          {body}
        </Interactive.Div>
      )}
    </div>
  );
};
