import type React from 'react';
import { color, text } from '../theme';

export const URL = 'soundcarvers.viniciusbregoli.dev';
const BAR = 46;

/** A minimal browser window around the content; content area is width × height. */
export const BrowserFrame: React.FC<{ width: number; height: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ width, height, children, style }) => (
  <div
    style={{
      width,
      borderRadius: 20,
      overflow: 'hidden',
      background: '#221d19',
      boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 40px 90px -20px rgba(0,0,0,0.75), 0 12px 30px rgba(0,0,0,0.4)',
      ...style,
    }}
  >
    <div style={{ height: BAR, display: 'flex', alignItems: 'center', gap: 9, padding: '0 18px' }}>
      {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
        <span key={c} style={{ width: 13, height: 13, borderRadius: 99, background: c, opacity: 0.85 }} />
      ))}
      <div
        style={{
          margin: '0 auto',
          padding: '6px 22px',
          borderRadius: 99,
          background: 'rgba(255,255,255,0.06)',
          color: color.tertiary,
          fontFamily: text,
          fontSize: 17,
          fontWeight: 500,
        }}
      >
        {URL}
      </div>
      <span style={{ width: 57 }} />
    </div>
    <div style={{ width, height }}>{children}</div>
  </div>
);

/** A phone with rounded bezel and a camera island; content area is width × height. */
export const PhoneFrame: React.FC<{ width: number; height: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ width, height, children, style }) => {
  const bezel = 14;
  return (
    <div
      style={{
        position: 'relative',
        padding: bezel,
        borderRadius: 64,
        background: '#0b0908',
        boxShadow: '0 0 0 2px #3a332d, 0 40px 90px -20px rgba(0,0,0,0.8)',
        ...style,
      }}
    >
      <div style={{ width, height, borderRadius: 64 - bezel, overflow: 'hidden' }}>{children}</div>
      <div style={{ position: 'absolute', top: bezel + 12, left: '50%', translate: '-50% 0', width: 110, height: 32, borderRadius: 99, background: '#000' }} />
    </div>
  );
};
