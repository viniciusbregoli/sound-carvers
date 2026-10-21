import type { Status } from '../lib/types';
import { STAGES } from '../lib/stages';

/** A pie that fills as a song moves toward stage-ready; shape carries the stage, not just color. */
export function StageIcon({ status, size = 16 }: { status: Status; size?: number }) {
  const fill = STAGES[status].fill;
  const r = 6;
  const angle = fill * 2 * Math.PI;
  const x = 8 + r * Math.sin(angle);
  const y = 8 - r * Math.cos(angle);
  const large = fill > 0.5 ? 1 : 0;
  return (
    <svg className={`stage-icon stage-${status}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={fill === 0 ? '2.4 2' : undefined} />
      {fill > 0 && fill < 1 && <path d={`M8 8 L8 ${8 - r} A${r} ${r} 0 ${large} 1 ${x} ${y} Z`} fill="currentColor" />}
      {fill === 1 && (
        <>
          <circle cx="8" cy="8" r="6" fill="currentColor" />
          <path d="M5.2 8.2 7.1 10 10.8 6.2" fill="none" stroke="var(--stage-check)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

export function StageBadge({ status }: { status: Status }) {
  return (
    <span className={`stage-badge stage-${status}`}>
      <StageIcon status={status} size={14} />
      {STAGES[status].label}
    </span>
  );
}
