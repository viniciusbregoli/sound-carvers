import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { artUrl } from '../lib/api';
import type { Match } from '../lib/types';
import { formatDuration } from '../lib/format';

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onPick: (match: Match) => void;
  /** Enter with no suggestion highlighted. */
  onEnter?: () => void;
  /** Escape when the suggestion list is already closed. */
  onEscape?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  describedBy?: string;
};

/** Text input with Deezer song suggestions, following the ARIA combobox pattern. */
export function SongSearch({ id, value, onChange, onPick, onEnter, onEscape, onBlur, placeholder, autoFocus, className, describedBy }: Props) {
  const listId = useId();
  const statusId = useId();
  const [matches, setMatches] = useState<Match[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const typed = useRef(false);

  useEffect(() => {
    const q = value.replace(/\s+[-–—]\s+/g, ' ').trim();
    if (!typed.current || q.length < 2) {
      setMatches([]);
      setState('idle');
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState('loading');
      try {
        const res = await fetch(`/api/lookup?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) throw new Error();
        const { matches } = (await res.json()) as { matches: Match[] };
        setMatches(matches);
        setActive(-1);
        setOpen(matches.length > 0);
        setState('done');
      } catch {
        if (!controller.signal.aborted) {
          setMatches([]);
          setOpen(false);
          setState('error');
        }
      }
    }, 280);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [value]);

  const pick = (match: Match) => {
    typed.current = false;
    setOpen(false);
    setMatches([]);
    setState('idle');
    onPick(match);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!matches.length) return;
      e.preventDefault();
      setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      // -1 is "back in the text"; wraps around the list in both directions.
      setActive((i) => {
        const next = i + step;
        if (next >= matches.length) return -1;
        if (next < -1) return matches.length - 1;
        return next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0) pick(matches[active]);
      else onEnter?.();
    } else if (e.key === 'Escape') {
      if (open) {
        // Close the list without closing a surrounding dialog.
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      } else onEscape?.();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const status =
    state === 'loading'
      ? 'Buscando no Deezer…'
      : state === 'error'
        ? 'A busca está fora do ar. Enter adiciona só o texto.'
        : state === 'done' && !matches.length
          ? 'Nada encontrado no Deezer. Enter adiciona só o texto.'
          : open
            ? `${matches.length} sugestões. Use as setas para escolher.`
            : '';

  return (
    <div className="combo">
      <input
        id={id}
        className={className}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-describedby={[statusId, describedBy].filter(Boolean).join(' ')}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder={placeholder}
        maxLength={240}
        value={value}
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setOpen(false);
          onBlur?.();
        }}
        onFocus={() => matches.length && setOpen(true)}
      />
      <ul id={listId} role="listbox" aria-label="Sugestões do Deezer" className="combo-list" hidden={!open}>
        {matches.map((m, i) => (
          <li
            key={m.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className="combo-option"
            // Keep focus in the input so blur doesn't close the list before the click lands.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(m)}
            onMouseMove={() => setActive(i)}
          >
            {m.art ? <img className="cover" src={artUrl(m.art)!} width={40} height={40} alt="" loading="lazy" /> : <span className="cover cover-generated" aria-hidden />}
            <span className="combo-text">
              <span className="combo-title">{m.title}</span>
              <span className="combo-sub">{[m.artist, m.album].filter(Boolean).join(' · ')}</span>
            </span>
            {m.duration && <span className="combo-length">{formatDuration(m.duration)}</span>}
          </li>
        ))}
      </ul>
      <p id={statusId} className="combo-status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}

