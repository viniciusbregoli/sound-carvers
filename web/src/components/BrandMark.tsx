/** A guitar pick with a carved waveform, matching the project icon. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <path fill="var(--bg)" d="M14 0H50Q64 0 64 14V50Q64 64 50 64H14Q0 64 0 50V14Q0 0 14 0Z" />
      <path fill="var(--accent-solid)" d="M32 8C19 8 9 12 9 23C9 36 22 52 29 57Q32 59 35 57C42 52 55 36 55 23C55 12 45 8 32 8Z" />
      <path fill="var(--accent-on-solid)" d="M19 28H24L29 18L36 35L40 28H48L45 34H43L35 47L29 32L28 34H16Z" />
    </svg>
  );
}
