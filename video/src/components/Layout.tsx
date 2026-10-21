import type React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { color } from '../theme';
import { Caption } from './Caption';
import { BrowserFrame } from './Frames';
import { Screen, type CameraKey, type Mark, type ShotLayer } from './Screen';

/** Warm dark backdrop with a slow amber glow, shared by every scene so cuts stay calm. */
export const Backdrop: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drift = interpolate(frame, [0, 10 * fps], [0, 6], { extrapolateRight: 'extend' });
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1100px 700px at ${18 + drift}% 12%, rgba(244, 162, 59, 0.13), transparent 70%), radial-gradient(900px 700px at 90% 100%, rgba(121, 167, 242, 0.06), transparent 70%), ${color.bg}`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/** Pop-in for frames: rises and settles over the first half second. */
export const useEntrance = (delay = 0) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const e = Easing.bezier(0.16, 1, 0.3, 1);
  return {
    opacity: interpolate(t, [delay, delay + 0.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: e }),
    translate: `0px ${interpolate(t, [delay, delay + 0.7], [40, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: e })}px`,
  };
};

export const FRAME_W = 1100;
export const FRAME_H = 619;

/** Caption on the left, the app in a browser window on the right. */
export const ShotScene: React.FC<{
  captions: React.ReactNode;
  shots: ShotLayer[];
  camera: CameraKey[];
  marks?: Mark[];
}> = ({ captions, shots, camera, marks }) => {
  const entrance = useEntrance(0.05);
  return (
    <Backdrop>
      <div style={{ position: 'absolute', left: 110, top: 0, bottom: 0, width: 580, display: 'grid', alignItems: 'center' }}>
        <div style={{ gridArea: '1 / 1' }}>{captions}</div>
      </div>
      <div style={{ position: 'absolute', right: 80, top: (1080 - FRAME_H - 46) / 2, ...entrance }}>
        <BrowserFrame width={FRAME_W} height={FRAME_H}>
          <Screen width={FRAME_W} height={FRAME_H} shots={shots} camera={camera} marks={marks} />
        </BrowserFrame>
      </div>
    </Backdrop>
  );
};

/** Several captions stacked in the same place, each fading in and out on its own schedule. */
export const Stack: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'grid', alignItems: 'center' }}>
    {(Array.isArray(children) ? children : [children]).map((c, i) => (
      <div key={i} style={{ gridArea: '1 / 1' }}>
        {c}
      </div>
    ))}
  </div>
);

export { Caption };
