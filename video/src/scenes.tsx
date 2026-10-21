import type React from 'react';
import { Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Backdrop, Caption, ShotScene, Stack, useEntrance } from './components/Layout';
import { PhoneFrame, URL } from './components/Frames';
import { box } from './components/Screen';
import { color, display, text } from './theme';

const e = Easing.bezier(0.16, 1, 0.3, 1);

/** The app icon: a guitar pick with a carved waveform. */
const Logo: React.FC<{ size: number; style?: React.CSSProperties }> = ({ size, style }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" style={style}>
    <path fill={color.accent} d="M32 8C19 8 9 12 9 23C9 36 22 52 29 57Q32 59 35 57C42 52 55 36 55 23C55 12 45 8 32 8Z" />
    <path fill={color.bg} d="M19 28H24L29 18L36 35L40 28H48L45 34H43L35 47L29 32L28 34H16Z" />
  </svg>
);

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const title = useEntrance(0.45);
  const sub = useEntrance(0.6);
  return (
    <Backdrop>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Logo
          size={190}
          style={{
            scale: String(interpolate(t, [0, 0.8], [0.4, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.spring({ damping: 14 }) })),
            rotate: `${interpolate(t, [0, 0.8], [-14, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: e })}deg`,
            opacity: interpolate(t, [0, 0.3], [0, 1], { extrapolateRight: 'clamp' }),
            filter: 'drop-shadow(0 20px 50px rgba(244,162,59,0.35))',
          }}
        />
        <div style={{ ...title, marginTop: 44, fontFamily: display, fontWeight: 800, fontSize: 150, letterSpacing: '-0.035em', color: color.text, lineHeight: 1 }}>
          Sound Carvers
        </div>
        <div style={{ ...sub, marginTop: 30, fontFamily: text, fontSize: 48, color: color.secondary }}>
          O caderno da banda: músicas, ensaios e shows.
        </div>
      </div>
    </Backdrop>
  );
};

export const SignIn: React.FC = () => (
  <ShotScene
    captions={
      <Stack>
        <Caption step="Primeiro acesso" title="Entre com a senha da banda" body="É uma senha só, a mesma pra todo mundo." outAt={3.3} />
        <Caption step="Primeiro acesso" title="Escolha quem você é" body="O celular lembra de você das próximas vezes." delay={3.6} />
      </Stack>
    }
    shots={[
      { src: '01b-login-filled', at: 0 },
      { src: '02-whoami', at: 3.4 },
    ]}
    camera={[
      { at: 0, x: 0.5, y: 0.47, zoom: 1.9 },
      { at: 3.3, x: 0.5, y: 0.47, zoom: 2.0 },
      { at: 3.6, x: 0.5, y: 0.5, zoom: 1.6 },
      { at: 7, x: 0.5, y: 0.5, zoom: 1.7 },
    ]}
  />
);

export const Board: React.FC = () => (
  <ShotScene
    captions={
      <Caption
        step="Músicas"
        title="Cada música anda pelo quadro"
        body="Arraste o card pra próxima coluna quando a banda evoluir."
      />
    }
    shots={[{ src: '03-board', at: 0 }]}
    camera={[
      { at: 0, x: 0.5, y: 0.5, zoom: 1 },
      { at: 1.0, x: 0.3, y: 0.55, zoom: 1.55 },
      { at: 6.0, x: 0.7, y: 0.55, zoom: 1.55 },
      { at: 7.6, x: 0.5, y: 0.5, zoom: 1.05 },
    ]}
    marks={[
      { box: box('03-board', 'todo'), from: 1.1, to: 2.4, label: 'Para aprender', tint: color.stage.todo },
      { box: box('03-board', 'learning'), from: 2.4, to: 3.7, label: 'Aprendendo', tint: color.stage.learning },
      { box: box('03-board', 'shaky'), from: 3.7, to: 5.0, label: 'Quase lá', tint: color.stage.shaky },
      { box: box('03-board', 'ready'), from: 5.0, to: 6.6, label: 'Pronta pro show', tint: color.stage.ready },
    ]}
  />
);

export const QuickAdd: React.FC = () => (
  <ShotScene
    captions={<Caption step="Adicionar" title="Digite o nome da música" body="Escolha a versão certa: capa, duração e BPM vêm junto." />}
    shots={[{ src: '04-quickadd', at: 0 }]}
    camera={[
      { at: 0, x: 0.55, y: 0.6, zoom: 1.2 },
      { at: 1.4, x: 0.62, y: 0.78, zoom: 2.2 },
      { at: 6.5, x: 0.62, y: 0.79, zoom: 2.3 },
    ]}
    marks={[{ box: { ...box('04-quickadd', 'input'), h: 0.43 }, from: 1.6 }]}
  />
);

export const Details: React.FC = () => (
  <ShotScene
    captions={
      <Caption
        step="Automático"
        title="Tom, afinação e links"
        body="Spotify, Cifra Club, Songsterr e YouTube aparecem sozinhos. Confira o tom de ouvido."
      />
    }
    shots={[{ src: '06-sheet-details', at: 0 }]}
    camera={[
      { at: 0, x: 0.8, y: 0.3, zoom: 1.6 },
      { at: 1.0, x: 0.81, y: 0.17, zoom: 2.4 },
      { at: 3.6, x: 0.81, y: 0.17, zoom: 2.4 },
      { at: 4.6, x: 0.81, y: 0.82, zoom: 2.4 },
    ]}
    marks={[
      { box: box('06-sheet-details', 'details'), from: 1.2, to: 3.7, pad: 0.004 },
      { box: box('06-sheet-details', 'links'), from: 4.6, pad: 0.004 },
    ]}
  />
);

export const Parts: React.FC = () => (
  <ShotScene
    captions={<Caption step="Quem faz o quê" title="Cada um anota a sua parte" body="Solo, base, voz, synth… e aparece no modo palco." />}
    shots={[{ src: '07-sheet-parts', at: 0 }]}
    camera={[
      { at: 0, x: 0.8, y: 0.35, zoom: 1.6 },
      { at: 1.0, x: 0.81, y: 0.33, zoom: 2.4 },
      { at: 6, x: 0.81, y: 0.34, zoom: 2.5 },
    ]}
    marks={[{ box: box('07-sheet-parts', 'parts'), from: 1.2, pad: 0.004 }]}
  />
);

export const Rating: React.FC = () => (
  <ShotScene
    captions={
      <Stack>
        <Caption step="Sua avaliação" title="Quanto você domina?" body="Não sei · Mais ou menos · Domino. Cada um avalia a própria parte." outAt={5.4} />
        <Caption step="Sua avaliação" title="Todo mundo domina?" body="A música vai sozinha pra Pronta pro show." delay={5.7} />
      </Stack>
    }
    shots={[
      { src: '08-domino-before', at: 0 },
      { src: '08-domino-after', at: 2.9 },
      { src: '09-domino-board', at: 6.0 },
    ]}
    camera={[
      { at: 0, x: 0.81, y: 0.2, zoom: 2.4 },
      { at: 3.4, x: 0.81, y: 0.2, zoom: 2.4 },
      { at: 4.2, x: 0.62, y: 0.62, zoom: 1.4 },
      { at: 5.8, x: 0.62, y: 0.62, zoom: 1.4 },
      { at: 6.8, x: 0.82, y: 0.5, zoom: 1.7 },
      { at: 10, x: 0.82, y: 0.5, zoom: 1.75 },
    ]}
    marks={[
      { box: box('08-domino-before', 'domino'), from: 1.0, to: 3.5, label: 'Julio marca Domino' },
      { box: box('08-domino-after', 'toast'), from: 4.2, to: 5.9 },
      { box: box('09-domino-board', 'everlong'), from: 6.6, label: 'Pronta pro show', tint: color.stage.ready },
    ]}
  />
);

export const Homework: React.FC = () => (
  <ShotScene
    captions={<Caption step="Dever de casa" title="Só o que falta pra você" body="Um toque e o quadro mostra só as músicas que você ainda não domina." />}
    shots={[{ src: '03-board', at: 0 }]}
    camera={[
      { at: 0, x: 0.5, y: 0.5, zoom: 1.1 },
      { at: 1.0, x: 0.3, y: 0.3, zoom: 2.1 },
      { at: 5, x: 0.31, y: 0.3, zoom: 2.2 },
    ]}
    marks={[{ box: box('03-board', 'filter'), from: 1.2 }]}
  />
);

export const SetlistsScene: React.FC = () => (
  <ShotScene
    captions={
      <Caption step="Setlists" title="Monte o show e o ensaio" body="Duração total, intervalos e aviso de troca de afinação." />
    }
    shots={[
      { src: '10-setlists', at: 0 },
      { src: '11-setlist-editor', at: 2.4 },
    ]}
    camera={[
      { at: 0, x: 0.35, y: 0.3, zoom: 1.6 },
      { at: 2.2, x: 0.35, y: 0.3, zoom: 1.6 },
      { at: 3.0, x: 0.28, y: 0.38, zoom: 1.8 },
      { at: 5.4, x: 0.28, y: 0.38, zoom: 1.8 },
      { at: 6.3, x: 0.3, y: 0.68, zoom: 1.8 },
      { at: 9, x: 0.31, y: 0.68, zoom: 1.85 },
    ]}
    marks={[
      { box: box('10-setlists', 'show'), from: 0.6, to: 2.3, pad: 0.008 },
      { box: { ...box('11-setlist-editor', 'summary'), w: 0.27 }, from: 3.2, to: 5.6 },
      { box: { ...box('11-setlist-editor', 'retune'), x: 0.138, w: 0.114 }, from: 6.4, tint: color.stage.shaky },
    ]}
  />
);

export const StageMode: React.FC = () => (
  <ShotScene
    captions={<Caption step="No show" title="Modo palco" body="Tela cheia com tom, BPM, quem faz o quê e a próxima música." />}
    shots={[
      { src: '12-stage', at: 0 },
      { src: '12b-stage-next', at: 4.6 },
      { src: '13-stage-overview', at: 7.0 },
    ]}
    camera={[
      { at: 0, x: 0.5, y: 0.5, zoom: 1.0 },
      { at: 1.0, x: 0.55, y: 0.6, zoom: 1.3 },
      { at: 4.4, x: 0.55, y: 0.62, zoom: 1.3 },
      { at: 5.2, x: 0.5, y: 0.75, zoom: 1.25 },
      { at: 6.8, x: 0.5, y: 0.75, zoom: 1.25 },
      { at: 7.4, x: 0.5, y: 0.5, zoom: 1.0 },
    ]}
    marks={[
      { box: box('12-stage', 'facts'), from: 1.2, to: 2.8, pad: 0.004 },
      { box: box('12-stage', 'parts'), from: 2.9, to: 4.5, pad: 0.004 },
      { box: box('12b-stage-next', 'next'), from: 5.2, to: 6.8, label: 'Próxima música', pad: 0.004 },
    ]}
  />
);

export const Phone: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const left = useEntrance(0.1);
  const right = useEntrance(0.3);
  const W = 320;
  const H = Math.round((W * 844) / 390);
  return (
    <Backdrop>
      <div style={{ position: 'absolute', left: 110, top: 0, bottom: 0, width: 640, display: 'grid', alignItems: 'center' }}>
        <Caption step="No celular" title="Leve no bolso" body="Abra no navegador do celular e adicione à tela inicial." width={640} />
      </div>
      <div style={{ position: 'absolute', right: 150, top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: 70 }}>
        {[
          { src: '15-phone-board', style: left, float: 0 },
          { src: '16-phone-stage', style: right, float: 1.4 },
        ].map((p) => (
          <div key={p.src} style={{ ...p.style }}>
            <PhoneFrame width={W} height={H + 40} style={{ translate: `0px ${Math.sin(t * 1.1 + p.float) * 8}px` }}>
              <div style={{ height: 40, background: p.src.includes('stage') ? '#050403' : '#14110f' }} />
              <Img src={staticFile(`shots/${p.src}.png`)} style={{ width: W, height: H, display: 'block' }} />
            </PhoneFrame>
          </div>
        ))}
      </div>
    </Backdrop>
  );
};

export const Live: React.FC = () => (
  <ShotScene
    captions={<Caption step="Banda" title="Todo mundo na mesma página" body="Mudou alguma coisa? Aparece na hora pra banda toda." />}
    shots={[{ src: '14-band', at: 0 }]}
    camera={[
      { at: 0, x: 0.5, y: 0.5, zoom: 1.0 },
      { at: 1.0, x: 0.8, y: 0.45, zoom: 1.75 },
      { at: 5, x: 0.8, y: 0.47, zoom: 1.8 },
    ]}
    marks={[{ box: { x: 0.68, y: 0.19, w: 0.275, h: 0.29 }, from: 1.2, label: 'Atividade recente' }]}
  />
);

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const head = useEntrance(0.2);
  const url = useEntrance(0.45);
  const note = useEntrance(0.65);
  return (
    <Backdrop>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Logo size={120} style={{ opacity: interpolate(t, [0, 0.4], [0, 1], { extrapolateRight: 'clamp' }) }} />
        <div style={{ ...head, marginTop: 36, fontFamily: display, fontWeight: 800, fontSize: 120, letterSpacing: '-0.03em', color: color.text }}>
          Bora ensaiar?
        </div>
        <div
          style={{
            ...url,
            marginTop: 40,
            padding: '22px 44px',
            borderRadius: 999,
            background: color.accent,
            color: color.onAccent,
            fontFamily: text,
            fontWeight: 700,
            fontSize: 52,
          }}
        >
          {URL}
        </div>
        <div style={{ ...note, marginTop: 34, fontFamily: text, fontSize: 44, color: color.secondary }}>A senha da banda está com o Vini.</div>
      </div>
    </Backdrop>
  );
};
