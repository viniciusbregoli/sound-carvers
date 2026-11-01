import { useState, type FormEvent } from 'react';
import { CircleCheck, PackageOpen, Plus, TriangleAlert, X } from 'lucide-react';
import { useBand } from '../lib/store';
import { Dialog } from '../components/Dialog';
import { Avatar } from '../components/Avatar';
import { useToast } from '../components/Toast';
import { formatMoney, parseMoney, plural } from '../lib/format';
import { RENTAL_STATUSES, type NewRental, type Rental, type RentalStatus, type Setlist } from '../lib/types';

/** Labels and colors (borrowed from the board stages) for where each item stands. */
export const RENTAL_STAGES: Record<RentalStatus, { label: string; tone: string }> = {
  needed: { label: 'A alugar', tone: 'stage-shaky' },
  reserved: { label: 'Reservado', tone: 'stage-learning' },
  picked_up: { label: 'Retirado', tone: 'stage-ready' },
  returned: { label: 'Devolvido', tone: 'stage-todo' },
};

/** What bands usually rent for a gig; one tap adds it. */
const COMMON_GEAR = [
  'Amplificador de guitarra',
  'Amplificador de baixo',
  'Bateria',
  'Teclado',
  'Mesa de som',
  'Caixas de som (PA)',
  'Retornos',
  'Microfones',
  'Pedestais de microfone',
  'Iluminação',
];

export function RentalsPanel({ setlist }: { setlist: Setlist }) {
  const { state, addRental, updateRental, deleteRental } = useBand();
  const [editing, setEditing] = useState<Rental | 'new' | null>(null);
  const toast = useToast();
  const rentals = state.rentals.filter((r) => r.setlistId === setlist.id);
  const pending = rentals.filter((r) => r.status === 'needed').length;
  const total = rentals.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const members = state.members.length;
  const membersById = new Map(state.members.map((m) => [m.id, m]));

  const listed = new Set(rentals.map((r) => r.name.toLocaleLowerCase('pt-BR')));
  const suggestions = COMMON_GEAR.filter((g) => !listed.has(g.toLocaleLowerCase('pt-BR')));
  const quickAdd = (name: string) => void addRental(setlist.id, { name }).catch(() => {});
  const remove = (r: Rental) =>
    void deleteRental(r.id)
      .then(() => toast.info(`“${r.name}” saiu da lista`, { label: 'Desfazer', run: () => void addRental(setlist.id, restorable(r)).catch(() => {}) }))
      .catch(() => {});

  return (
    <section className="rentals" aria-labelledby="rentals-title">
      <h2 id="rentals-title" className="visually-hidden">
        Equipamento para alugar
      </h2>

      {rentals.length > 0 && (
        <div className="editor-summary" aria-live="polite">
          <span>
            <strong>{plural(rentals.length, 'item', 'itens')}</strong>
          </span>
          {pending > 0 ? (
            <span className="warn">
              <TriangleAlert size={16} aria-hidden /> {pending === 1 ? '1 ainda a alugar' : `${pending} ainda a alugar`}
            </span>
          ) : (
            <span className="ok">
              <CircleCheck size={16} aria-hidden /> Tudo reservado
            </span>
          )}
          {total > 0 && (
            <span>
              Total <strong>{formatMoney(total)}</strong>
              {members > 1 && <span className="muted"> · {formatMoney(Math.ceil(total / members))} por integrante</span>}
            </span>
          )}
        </div>
      )}

      {rentals.length === 0 ? (
        <div className="order-empty rentals-empty">
          <PackageOpen size={28} className="rentals-empty-icon" aria-hidden />
          <p className="display-sm">Nada para alugar ainda</p>
          <p className="muted">Anote o que a banda precisa alugar para este show: quem cuida, onde alugar e quanto custa.</p>
        </div>
      ) : (
        <ul className="rental-list" role="list">
          {rentals.map((r) => {
            const member = r.memberId ? membersById.get(r.memberId) : undefined;
            const details = [r.supplier, member?.name, r.notes.split('\n')[0]].filter(Boolean);
            return (
              <li key={r.id} className={`rental-row${r.status === 'returned' ? ' is-done' : ''}`}>
                <label className={`rental-status ${RENTAL_STAGES[r.status].tone}`}>
                  <span className="visually-hidden">Situação de {r.name}</span>
                  <select value={r.status} onChange={(e) => void updateRental(r.id, { status: e.target.value as RentalStatus }).catch(() => {})}>
                    {RENTAL_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {RENTAL_STAGES[s].label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="rental-main" onClick={() => setEditing(r)}>
                  <span className="rental-name">
                    {r.quantity > 1 && <span className="rental-qty">{r.quantity}×</span>}
                    {r.name}
                  </span>
                  {details.length > 0 && <span className="rental-details">{details.join(' · ')}</span>}
                </button>
                {member && (
                  <span className="rental-who" title={`${member.name} cuida disso`}>
                    <Avatar member={member} size="sm" />
                  </span>
                )}
                {r.cost != null && <span className="rental-cost">{formatMoney(r.cost)}</span>}
                <button type="button" className="icon-btn icon-btn-sm row-remove" aria-label={`Remover ${r.name}`} onClick={() => remove(r)}>
                  <X size={16} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="order-add">
        <button className="btn btn-secondary" onClick={() => setEditing('new')}>
          <Plus size={18} aria-hidden />
          Adicionar item
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="gear-suggestions">
          <h3 className="section-title" id="gear-title">
            Adicionar rápido
          </h3>
          <ul className="gear-chips" role="list" aria-labelledby="gear-title">
            {suggestions.map((name) => (
              <li key={name}>
                <button type="button" className="chip-toggle" onClick={() => quickAdd(name)}>
                  <Plus size={14} aria-hidden /> {name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <RentalDialog
        key={editing === 'new' ? 'new' : editing?.id ?? 'closed'}
        setlistId={setlist.id}
        rental={editing}
        onClose={() => setEditing(null)}
        onRemove={remove}
      />
    </section>
  );
}

/** Everything needed to put a removed item back (it gets a new id). */
const restorable = ({ name, quantity, supplier, cost, memberId, status, notes }: Rental): NewRental => ({ name, quantity, supplier, cost, memberId, status, notes });

function RentalDialog({
  setlistId,
  rental,
  onClose,
  onRemove,
}: {
  setlistId: string;
  rental: Rental | 'new' | null;
  onClose: () => void;
  onRemove: (rental: Rental) => void;
}) {
  const { state, addRental, updateRental } = useBand();
  const current = rental && rental !== 'new' ? rental : null;
  const [name, setName] = useState(current?.name ?? '');
  const [quantity, setQuantity] = useState(String(current?.quantity ?? 1));
  const [supplier, setSupplier] = useState(current?.supplier ?? '');
  const [cost, setCost] = useState(current?.cost != null ? (current.cost / 100).toFixed(2).replace('.', ',') : '');
  const [memberId, setMemberId] = useState(current?.memberId ?? '');
  const [status, setStatus] = useState<RentalStatus>(current?.status ?? 'needed');
  const [notes, setNotes] = useState(current?.notes ?? '');
  const [costError, setCostError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(cost);
    if (cents === undefined || (cents !== null && cents > 100_000_000)) {
      setCostError('Escreva só o valor, como 150 ou 89,90');
      return;
    }
    const fields: NewRental = {
      name: name.trim(),
      quantity: Math.min(999, Math.max(1, Number.parseInt(quantity, 10) || 1)),
      supplier: supplier.trim(),
      cost: cents,
      memberId: memberId || null,
      status,
      notes,
    };
    setBusy(true);
    try {
      if (current) await updateRental(current.id, fields);
      else await addRental(setlistId, fields);
      onClose();
    } catch {
      // Store showed the error.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!rental} onClose={onClose} title={current ? 'Editar item' : 'Alugar para o show'}>
      <form className="stack-4" onSubmit={submit}>
        <div className="details-grid rental-name-grid">
          <div className="field">
            <label htmlFor="rental-name">O que alugar</label>
            <input
              id="rental-name"
              autoFocus={!current}
              required
              maxLength={120}
              list="rental-gear"
              placeholder="Amplificador de baixo"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <datalist id="rental-gear">
              {COMMON_GEAR.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="rental-qty">Quantidade</label>
            <input id="rental-qty" type="number" inputMode="numeric" min={1} max={999} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
        </div>

        <fieldset className="field">
          <legend>Situação</legend>
          <div className="segmented rental-segmented">
            {RENTAL_STATUSES.map((s) => (
              <label key={s} className={`segment ${RENTAL_STAGES[s].tone}`}>
                <input type="radio" name="rental-status" value={s} checked={status === s} onChange={() => setStatus(s)} />
                <span className="rental-dot" aria-hidden />
                {RENTAL_STAGES[s].label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="details-grid details-grid-2">
          <div className="field">
            <label htmlFor="rental-member">
              Quem cuida <span className="optional">opcional</span>
            </label>
            <select id="rental-member" className="select" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">Ninguém ainda</option>
              {state.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rental-cost">
              Valor total <span className="optional">opcional</span>
            </label>
            <div className="money-input">
              <span aria-hidden>R$</span>
              <input
                id="rental-cost"
                inputMode="decimal"
                placeholder="0,00"
                value={cost}
                onChange={(e) => {
                  setCost(e.target.value);
                  setCostError(null);
                }}
                aria-invalid={!!costError}
                aria-describedby={costError ? 'rental-cost-error' : undefined}
              />
            </div>
            {costError && (
              <p id="rental-cost-error" className="field-error">
                {costError}
              </p>
            )}
          </div>
        </div>

        <div className="field">
          <label htmlFor="rental-supplier">
            Onde alugar <span className="optional">opcional</span>
          </label>
          <input id="rental-supplier" maxLength={120} placeholder="Loja, estúdio ou contato" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="rental-notes">
            Anotações <span className="optional">opcional</span>
          </label>
          <textarea
            id="rental-notes"
            rows={2}
            maxLength={2000}
            placeholder="Horário de retirada e devolução, caução, modelo…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="row-end">
          {current && (
            <button
              type="button"
              className="btn btn-ghost btn-danger-text rental-delete"
              onClick={() => {
                onClose();
                onRemove(current);
              }}
            >
              Remover
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            {current ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
