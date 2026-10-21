import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import type { Member } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { MemberForm } from '../components/MemberForm';
import { BrandMark } from '../components/BrandMark';

export function WhoAreYou({ bandName, members, onDone }: { bandName: string; members: Member[]; onDone: () => void }) {
  const [adding, setAdding] = useState(members.length === 0);
  const [error, setError] = useState<string | null>(null);

  const pick = async (memberId: string) => {
    try {
      await api('POST', '/api/whoami', { memberId });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <main className="center-screen">
      <div className="panel who">
        <BrandMark size={44} />
        <div className="stack-2">
          <h1 className="display-md">{adding && members.length === 0 ? `Boas-vindas ao ${bandName}` : 'Quem está tocando?'}</h1>
          <p className="muted">
            {adding
              ? 'Adicione seu nome para a banda saber quem domina o quê.'
              : 'Escolha o seu nome. Este aparelho vai lembrar de você.'}
          </p>
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {adding ? (
          <MemberForm
            submitLabel="Entrar na banda"
            usedColors={members.map((m) => m.color)}
            onCancel={members.length ? () => setAdding(false) : undefined}
            onSubmit={async (values) => {
              try {
                const { id } = await api<{ id: string }>('POST', '/api/members', values);
                await pick(id);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          />
        ) : (
          <>
            <ul className="who-grid" role="list">
              {members.map((m) => (
                <li key={m.id}>
                  <button className="who-option" onClick={() => pick(m.id)}>
                    <Avatar member={m} size="lg" />
                    <span className="who-name">{m.name}</span>
                    {m.instrument && <span className="who-instrument">{m.instrument}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <button className="btn btn-secondary btn-block" onClick={() => setAdding(true)}>
              <UserPlus size={18} aria-hidden />
              Não estou na lista
            </button>
          </>
        )}
      </div>
    </main>
  );
}
