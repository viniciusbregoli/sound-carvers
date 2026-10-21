import { useState, type FormEvent } from 'react';
import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { MEMBER_COLORS } from '../lib/stages';
import type { Member } from '../lib/types';

type Values = Pick<Member, 'name' | 'instrument' | 'color'>;

export function MemberForm({
  initial,
  usedColors = [],
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Values;
  usedColors?: string[];
  submitLabel: string;
  onSubmit: (values: Values) => Promise<void> | void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [instrument, setInstrument] = useState(initial?.instrument ?? '');
  const [color, setColor] = useState(initial?.color ?? MEMBER_COLORS.find((c) => !usedColors.includes(c.value))?.value ?? MEMBER_COLORS[0].value);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), instrument: instrument.trim(), color });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack-4" onSubmit={submit}>
      <div className="field">
        <label htmlFor="member-name">Nome</label>
        <input id="member-name" required maxLength={40} autoFocus value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
      </div>
      <div className="field">
        <label htmlFor="member-instrument">
          O que você toca <span className="optional">opcional</span>
        </label>
        <input
          id="member-instrument"
          maxLength={60}
          placeholder="Guitarra, voz"
          value={instrument}
          onChange={(e) => setInstrument(e.target.value)}
          list="instrument-suggestions"
        />
        <datalist id="instrument-suggestions">
          {['Voz', 'Guitarra', 'Violão', 'Baixo', 'Bateria', 'Teclado', 'Percussão', 'Guitarra, voz', 'Baixo, voz', 'Violão, voz', 'Saxofone'].map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      </div>
      <fieldset className="field">
        <legend>Sua cor</legend>
        <div className="swatches">
          {MEMBER_COLORS.map((c) => (
            <label key={c.value} className="swatch" style={{ '--swatch': c.value } as CSSProperties}>
              <input
                type="radio"
                name="member-color"
                value={c.value}
                checked={color === c.value}
                onChange={() => setColor(c.value)}
                aria-label={c.name}
              />
              <Check size={16} strokeWidth={3} aria-hidden />
            </label>
          ))}
        </div>
      </fieldset>
      <div className="row-end">
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
