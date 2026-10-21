import { createContext, useContext, useState } from 'react';
import { KanbanSquare, ListMusic, Users } from 'lucide-react';
import { Link, usePath } from '../lib/router';
import { useBand } from '../lib/store';
import { Avatar } from '../components/Avatar';
import { BrandMark } from '../components/BrandMark';
import { Board } from './Board';
import { SongSheet } from './SongSheet';
import { Setlists } from './Setlists';
import { SetlistEditor } from './SetlistEditor';
import { Stage } from './Stage';
import { Band } from './Band';

const SongSheetCtx = createContext<(id: string) => void>(() => {});
export const useOpenSong = () => useContext(SongSheetCtx);

const NAV = [
  { href: '/', label: 'Músicas', icon: KanbanSquare, match: (p: string) => p === '/' },
  { href: '/setlists', label: 'Setlists', icon: ListMusic, match: (p: string) => p.startsWith('/setlists') },
  { href: '/band', label: 'Banda', icon: Users, match: (p: string) => p.startsWith('/band') },
];

export function Shell({ bandName, onSwitchMember }: { bandName: string; onSwitchMember: () => void }) {
  const path = usePath();
  const { me } = useBand();
  const [openSongId, setOpenSongId] = useState<string | null>(null);

  const stage = path.match(/^\/setlists\/([^/]+)\/stage$/);
  if (stage) return <Stage setlistId={stage[1]} />;

  const setlist = path.match(/^\/setlists\/([^/]+)$/);
  let page;
  if (path === '/') page = <Board />;
  else if (path === '/setlists') page = <Setlists />;
  else if (setlist) page = <SetlistEditor setlistId={setlist[1]} />;
  else if (path === '/band') page = <Band onSwitchMember={onSwitchMember} />;
  else
    page = (
      <div className="empty-page">
        <h1 className="display-sm">Nada por aqui</h1>
        <p className="muted">Esta página não existe.</p>
        <Link className="btn btn-secondary" href="/">
          Voltar para as músicas
        </Link>
      </div>
    );

  return (
    <SongSheetCtx.Provider value={setOpenSongId}>
      <a className="skip-link" href="#main">
        Pular para o conteúdo
      </a>
      <header className="topbar">
        <Link href="/" className="brand" aria-label={`${bandName}, músicas`}>
          <BrandMark size={30} />
          <span className="brand-name">{bandName}</span>
        </Link>
        <nav className="nav" aria-label="Principal">
          {NAV.map(({ href, label, icon: Icon, match }) => (
            <Link key={href} href={href} className="nav-link" aria-current={match(path) ? 'page' : undefined}>
              <Icon size={20} strokeWidth={1.75} aria-hidden />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        {me && (
          <Link href="/band" className="topbar-me" aria-label={`Conectado como ${me.name}. Ajustes da banda`}>
            <Avatar member={me} size="md" />
          </Link>
        )}
      </header>
      <main id="main" className="main" tabIndex={-1}>
        {page}
      </main>
      <SongSheet songId={openSongId} onClose={() => setOpenSongId(null)} />
    </SongSheetCtx.Provider>
  );
}
