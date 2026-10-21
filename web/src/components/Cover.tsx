import { useEffect, useState, type CSSProperties } from 'react';

const tints = new Map<string, string | null>();

/** Hue for songs without artwork, stable per title. */
export function titleHue(title: string) {
  let h = 0;
  for (const ch of title.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/**
 * The cover's dominant color, weighted toward saturated pixels so a mostly-black sleeve with a red logo
 * reads as red. Covers are same-origin, so the canvas isn't tainted.
 */
export function useCoverTint(src: string | null) {
  const [tint, setTint] = useState(() => (src ? (tints.get(src) ?? null) : null));
  useEffect(() => {
    if (!src) return setTint(null);
    if (tints.has(src)) return setTint(tints.get(src)!);
    let cancelled = false;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 12;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, 12, 12);
        const px = ctx.getImageData(0, 0, 12, 12).data;
        let r = 0, g = 0, b = 0, total = 0;
        for (let i = 0; i < px.length; i += 4) {
          const max = Math.max(px[i], px[i + 1], px[i + 2]);
          const min = Math.min(px[i], px[i + 1], px[i + 2]);
          const weight = 0.1 + (max ? (max - min) / max : 0) * (max / 255);
          r += px[i] * weight;
          g += px[i + 1] * weight;
          b += px[i + 2] * weight;
          total += weight;
        }
        const color = `rgb(${Math.round(r / total)} ${Math.round(g / total)} ${Math.round(b / total)})`;
        tints.set(src, color);
        if (!cancelled) setTint(color);
      } catch {
        tints.set(src, null);
      }
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return tint;
}

/** Album art, or a generated tile with the title's initials when there is none. Decorative: the title is always next to it. */
export function CoverArt({ src, title, size, className = '' }: { src: string | null; title: string; size: number; className?: string }) {
  const style = { '--size': `${size}px` } as CSSProperties;
  if (src) return <img className={`cover ${className}`} src={src} width={size} height={size} alt="" loading="lazy" decoding="async" style={style} />;
  const letters = title
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <span className={`cover cover-generated ${className}`} style={{ ...style, '--hue': titleHue(title) } as CSSProperties} aria-hidden>
      {letters || '♪'}
    </span>
  );
}

/** Background tint for a song surface: the cover's color, or the generated tile's hue. */
export function useSongTint(cover: string | null, title: string): CSSProperties {
  const tint = useCoverTint(cover);
  return { '--tint': tint ?? (cover ? 'transparent' : `oklch(0.6 0.12 ${titleHue(title)})`) } as CSSProperties;
}
