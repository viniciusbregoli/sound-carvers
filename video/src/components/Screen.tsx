import type React from 'react';
import { Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import boxes from '../../public/boxes.json';
import { color, text } from '../theme';

export type Rect = { x: number; y: number; w: number; h: number };
/** Where the camera looks at a moment (seconds): the focused point (0..1 of the screenshot) and zoom. */
export type CameraKey = { at: number; x: number; y: number; zoom: number };
/** An outline drawn on the screenshot from `from` to `to` seconds; `dim` darkens everything around it. */
export type Mark = { box: Rect; from: number; to?: number; label?: string; tint?: string; dim?: boolean; pad?: number };
/** Screenshots shown in order; each one fades in at `at` seconds. */
export type ShotLayer = { src: string; at: number };

type ShotName = keyof typeof boxes;
/** The rect of an element recorded during capture, e.g. box('03-board', 'ready'). */
export const box = <S extends ShotName>(shot: S, key: keyof (typeof boxes)[S]): Rect => boxes[shot][key] as Rect;
/** Grow a rect by a fraction of the screenshot width/height. */
export const grow = (r: Rect, dx: number, dy = dx): Rect => ({ x: r.x - dx, y: r.y - dy, w: r.w + 2 * dx, h: r.h + 2 * dy });

const cameraEase = Easing.bezier(0.65, 0, 0.35, 1);
const fadeEase = Easing.bezier(0.16, 1, 0.3, 1);

function cameraAt(keys: CameraKey[], t: number) {
  if (keys.length === 1) return keys[0];
  const at = keys.map((k) => k.at);
  const pick = (f: (k: CameraKey) => number) =>
    interpolate(t, at, keys.map(f), { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: cameraEase });
  return { x: pick((k) => k.x), y: pick((k) => k.y), zoom: pick((k) => k.zoom) };
}

type Props = {
  shots: ShotLayer[];
  camera: CameraKey[];
  marks?: Mark[];
  width: number;
  height: number;
  radius?: number;
};

/** A screenshot viewport with a virtual camera (pan and zoom) and highlight marks that move with it. */
export const Screen: React.FC<Props> = ({ shots, camera, marks = [], width, height, radius = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cam = cameraAt(camera, t);
  const zoom = Math.max(1, cam.zoom);
  // Keep the screenshot covering the viewport.
  const cx = Math.min(Math.max(cam.x, 0.5 / zoom), 1 - 0.5 / zoom);
  const cy = Math.min(Math.max(cam.y, 0.5 / zoom), 1 - 0.5 / zoom);

  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden', borderRadius: radius, background: color.bg }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width,
          height,
          transformOrigin: '0 0',
          translate: `${width / 2 - cx * width * zoom}px ${height / 2 - cy * height * zoom}px`,
          scale: String(zoom),
        }}
      >
        {shots.map((s, i) => (
          <Img
            key={s.src}
            src={staticFile(`shots/${s.src}.png`)}
            style={{
              position: 'absolute',
              inset: 0,
              width,
              height,
              opacity: i === 0 ? 1 : interpolate(t, [s.at, s.at + 0.45], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: fadeEase }),
            }}
          />
        ))}
        {marks.map((m, i) => {
          const end = m.to ?? Infinity;
          const opacity = Math.min(
            interpolate(t, [m.from, m.from + 0.35], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: fadeEase }),
            end === Infinity ? 1 : interpolate(t, [end - 0.3, end], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          );
          if (opacity <= 0) return null;
          const r = grow(m.box, m.pad ?? 0.006, ((m.pad ?? 0.006) * width) / height);
          const tint = m.tint ?? color.accent;
          const pop = interpolate(t, [m.from, m.from + 0.45], [1.04, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: fadeEase });
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: r.x * width,
                top: r.y * height,
                width: r.w * width,
                height: r.h * height,
                opacity,
                scale: String(pop),
                borderRadius: 14 / zoom,
                outline: `${4 / zoom}px solid ${tint}`,
                boxShadow: `0 0 ${28 / zoom}px ${tint}66${m.dim ? `, 0 0 0 ${4000 / zoom}px rgba(8, 6, 5, 0.55)` : ''}`,
              }}
            >
              {m.label && (
                <div
                  style={{
                    position: 'absolute',
                    left: -4 / zoom,
                    bottom: `calc(100% + ${14 / zoom}px)`,
                    padding: `${8 / zoom}px ${16 / zoom}px`,
                    borderRadius: 999,
                    background: tint,
                    color: color.onAccent,
                    fontFamily: text,
                    fontWeight: 700,
                    fontSize: 26 / zoom,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.label}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
