import { useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { api } from '../lib/api';
import { BrandMark } from '../components/BrandMark';

export function Login({ bandName, onDone }: { bandName: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/login', { password });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="center-screen login">
      <form className="panel narrow login-panel" onSubmit={submit}>
        <BrandMark size={56} />
        <div className="stack-2">
          <h1 className="display-md">{bandName}</h1>
          <p className="muted">Músicas, setlists e ensaios, tudo num lugar só.</p>
        </div>
        <div className="field">
          <label htmlFor="password">Senha da banda</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? 'password-error' : undefined}
          />
          {error && (
            <p id="password-error" className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !password}>
          {busy ? 'Verificando…' : 'Entrar'}
          {!busy && <ArrowRight size={18} aria-hidden />}
        </button>
      </form>
    </main>
  );
}
