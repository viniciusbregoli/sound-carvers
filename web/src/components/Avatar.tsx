import { Check, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Level, Member } from '../lib/types';
import { LEVELS } from '../lib/stages';
import { initials } from '../lib/format';

export function Avatar({ member, size = 'md' }: { member: Member; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return (
    <span className={`avatar avatar-${size}`} style={{ '--member': member.color } as CSSProperties} aria-hidden>
      {initials(member.name)}
    </span>
  );
}

export function LevelGlyph({ level }: { level: Level }) {
  if (level === 3) return <Check size={10} strokeWidth={3} aria-hidden />;
  if (level === 1) return <X size={10} strokeWidth={3} aria-hidden />;
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M1.5 5.5c1-1.6 2-1.6 3 0s2 1.6 3 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Every member's self-rating on a song; unrated members are dimmed. */
export function ConfidenceStack({ members, levels }: { members: Member[]; levels: Map<string, Level> }) {
  if (!members.length) return null;
  const label = members
    .map((m) => `${m.name}: ${levels.has(m.id) ? LEVELS[levels.get(m.id)!].label.toLowerCase() : 'sem avaliação'}`)
    .join(', ');
  return (
    <span className="confidence-stack" role="img" aria-label={`Quem domina: ${label}`} title={label}>
      {members.map((m) => {
        const level = levels.get(m.id);
        return (
          <span key={m.id} className={`confidence-chip ${level ? `level-${level}` : 'level-none'}`} style={{ '--member': m.color } as CSSProperties}>
            <Avatar member={m} size="sm" />
            {level && (
              <span className="confidence-glyph">
                <LevelGlyph level={level} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
