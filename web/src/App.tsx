import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api';
import { BandProvider } from './lib/store';
import type { BandState } from './lib/types';
import { Login } from './views/Login';
import { WhoAreYou } from './views/WhoAreYou';
import { Shell } from './views/Shell';

type Session = { authed: boolean; memberId: string | null; bandName: string };

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<BandState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const s = await api<Session>('GET', '/api/session');
      if (s.authed) setState(await api<BandState>('GET', '/api/state'));
      setSession(s);
    } catch (err) {
      setFailed((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <main className="center-screen">
        <div className="panel narrow">
          <h1 className="display-sm">Não foi possível carregar a banda</h1>
          <p className="muted">{failed}</p>
          <button className="btn btn-primary" onClick={load}>
            Tentar de novo
          </button>
        </div>
      </main>
    );
  }
  if (!session) return <div className="center-screen" aria-busy="true" />;
  if (!session.authed || !state) return <Login bandName={session.bandName} onDone={load} />;
  if (!session.memberId || !state.members.some((m) => m.id === session.memberId)) {
    return <WhoAreYou bandName={session.bandName} members={state.members} onDone={load} />;
  }
  return (
    <BandProvider initial={state} memberId={session.memberId}>
      <Shell bandName={session.bandName} onSwitchMember={() => setSession({ ...session, memberId: null })} />
    </BandProvider>
  );
}
