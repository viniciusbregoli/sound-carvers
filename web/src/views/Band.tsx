import { useState } from 'react';
import { LogOut, Monitor, Moon, Pencil, Sun, UserPlus, UserRoundX } from 'lucide-react';
import { useBand } from '../lib/store';
import { api } from '../lib/api';
import { Avatar } from '../components/Avatar';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { MemberForm } from '../components/MemberForm';
import { STAGES, LEVELS } from '../lib/stages';
import { plural, timeAgo } from '../lib/format';
import type { Activity, Member, Status } from '../lib/types';

type Theme = 'system' | 'dark' | 'light';

function applyTheme(theme: Theme) {
  try {
    if (theme === 'system') localStorage.removeItem('sc-theme');
    else localStorage.setItem('sc-theme', theme);
  } catch {
    // Private mode: the choice just won't persist.
  }
  const light = theme === 'light' || (theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
  // Snap the theme instead of cross-fading every surface at once.
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{transition:none !important}';
  document.head.appendChild(style);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  void document.body.offsetHeight;
  requestAnimationFrame(() => style.remove());
}

export function Band({ onSwitchMember }: { onSwitchMember: () => void }) {
  const { state, me, addMember, updateMember, deleteMember } = useBand();
  const [editing, setEditing] = useState<Member | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('sc-theme') as Theme | null) ?? 'system');

  const solidCount = (memberId: string) => state.confidence.filter((c) => c.memberId === memberId && c.level === 3).length;

  return (
    <div className="band-page">
      <div className="page-head">
        <div className="page-title">
          <h1 className="display-lg">Banda</h1>
          <p className="muted">{plural(state.members.length, 'integrante')}</p>
        </div>
        <button className="btn btn-secondary" onClick={() => setAdding(true)}>
          <UserPlus size={18} aria-hidden />
          Adicionar integrante
        </button>
      </div>

      <div className="band-layout">
        <div className="stack-6">
          <section aria-labelledby="members-title">
            <h2 id="members-title" className="group-title">
              Integrantes
            </h2>
            <ul className="members" role="list">
              {state.members.map((m) => (
                <li key={m.id} className="member-row">
                  <Avatar member={m} size="lg" />
                  <div className="member-text">
                    <span className="member-name">
                      {m.name}
                      {m.id === me?.id && <span className="tag">Você</span>}
                    </span>
                    <span className="muted">
                      {[m.instrument, state.songs.length ? `domina ${solidCount(m.id)} de ${plural(state.songs.length, 'música')}` : null].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <div className="member-actions">
                    <button className="icon-btn" aria-label={`Editar ${m.name}`} onClick={() => setEditing(m)}>
                      <Pencil size={18} aria-hidden />
                    </button>
                    {m.id !== me?.id && (
                      <button className="icon-btn icon-btn-danger" aria-label={`Remover ${m.name}`} onClick={() => setRemoving(m)}>
                        <UserRoundX size={18} aria-hidden />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="device-title" className="stack-4">
            <h2 id="device-title" className="group-title">
              Este aparelho
            </h2>
            <div className="device-card">
              <fieldset className="field">
                <legend>Aparência</legend>
                <div className="segmented">
                  {(
                    [
                      ['system', 'Automática', Monitor],
                      ['dark', 'Escura', Moon],
                      ['light', 'Clara', Sun],
                    ] as const
                  ).map(([value, label, Icon]) => (
                    <label key={value} className="segment">
                      <input
                        type="radio"
                        name="theme"
                        value={value}
                        checked={theme === value}
                        onChange={() => {
                          setTheme(value);
                          applyTheme(value);
                        }}
                      />
                      <Icon size={16} aria-hidden />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="row">
                <button className="btn btn-secondary" onClick={onSwitchMember}>
                  Não é {me?.name}? Trocar
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={async () => {
                    await api('POST', '/api/logout').catch(() => {});
                    location.href = '/';
                  }}
                >
                  <LogOut size={18} aria-hidden />
                  Sair
                </button>
              </div>
            </div>
          </section>
        </div>

        <section aria-labelledby="activity-title" className="activity">
          <h2 id="activity-title" className="group-title">
            Atividade recente
          </h2>
          {state.activity.length === 0 ? (
            <p className="muted">Nada ainda. As mudanças em músicas e setlists aparecem aqui.</p>
          ) : (
            <ol className="activity-list" role="list">
              {state.activity.slice(0, 40).map((a) => (
                <ActivityRow key={a.id} activity={a} member={state.members.find((m) => m.id === a.memberId)} />
              ))}
            </ol>
          )}
        </section>
      </div>

      <Dialog open={adding} onClose={() => setAdding(false)} title="Adicionar integrante">
        <MemberForm
          submitLabel="Adicionar integrante"
          usedColors={state.members.map((m) => m.color)}
          onCancel={() => setAdding(false)}
          onSubmit={async (values) => {
            await addMember(values);
            setAdding(false);
          }}
        />
      </Dialog>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing ? `Editar ${editing.name}` : 'Editar'}>
        {editing && (
          <MemberForm
            initial={editing}
            submitLabel="Salvar"
            onCancel={() => setEditing(null)}
            onSubmit={async (values) => {
              await updateMember(editing.id, values);
              setEditing(null);
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remover ${removing?.name}?`}
        message="As avaliações dessa pessoa em todas as músicas serão apagadas. Ela pode voltar com a senha da banda, mas as avaliações não voltam."
        confirmLabel="Remover integrante"
        onConfirm={() => removing && void deleteMember(removing.id).catch(() => {})}
      />
    </div>
  );
}

function ActivityRow({ activity: a, member }: { activity: Activity; member?: Member }) {
  const d = a.detail as Record<string, string | number>;
  const who = member?.name ?? 'Alguém';
  let text: string;
  switch (a.kind) {
    case 'song.added':
      text = `adicionou “${d.title}”`;
      break;
    case 'song.moved':
      text = d.auto
        ? `fechou “${d.title}”: todo mundo domina, foi para ${STAGES[d.to as Status]?.label ?? d.to}`
        : `moveu “${d.title}” para ${STAGES[d.to as Status]?.label ?? d.to}`;
      break;
    case 'song.confidence':
      text = `marcou “${LEVELS[d.level as 1 | 2 | 3]?.label}” em “${d.title}”`;
      break;
    case 'song.deleted':
      text = `excluiu “${d.title}”`;
      break;
    case 'song.text':
      text = `adicionou ${{ lyrics: 'a letra', chords: 'a cifra', tab: 'a tablatura' }[d.kind as string] ?? 'uma anotação'} de “${d.title}”`;
      break;
    case 'song.file':
      text = d.kind === 'audio' ? `enviou o áudio “${d.name}” em “${d.title}”` : `enviou uma imagem em “${d.title}”`;
      break;
    case 'setlist.created':
      text = `criou ${d.kind === 'rehearsal' ? 'o ensaio' : 'o show'} “${d.name}”`;
      break;
    case 'setlist.deleted':
      text = `excluiu o setlist “${d.name}”`;
      break;
    case 'member.joined':
      text = `${d.name} entrou na banda`;
      break;
    case 'member.removed':
      text = `removeu ${d.name}`;
      break;
    default:
      text = 'fez uma alteração';
  }
  const joined = a.kind === 'member.joined';
  return (
    <li className="activity-row">
      {member ? <Avatar member={member} size="sm" /> : <span className="avatar avatar-sm avatar-ghost" aria-hidden />}
      <p>
        {!joined && <strong>{who} </strong>}
        {joined ? <strong>{text}</strong> : text}
        <span className="activity-time"> · {timeAgo(a.createdAt)}</span>
      </p>
    </li>
  );
}
