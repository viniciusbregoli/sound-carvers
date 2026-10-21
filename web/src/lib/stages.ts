import type { Level, Status } from './types';

export const STAGES: Record<Status, { label: string; hint: string; fill: number }> = {
  todo: { label: 'Para aprender', hint: 'Está na lista. Ninguém começou ainda.', fill: 0 },
  learning: { label: 'Aprendendo', hint: 'Estamos tirando as partes.', fill: 1 / 3 },
  shaky: { label: 'Quase lá', hint: 'Já sai, mas ainda sem segurança.', fill: 2 / 3 },
  ready: { label: 'Pronta pro show', hint: 'Tocaríamos hoje à noite.', fill: 1 },
};

export const LEVELS: Record<Level, { label: string; hint: string }> = {
  1: { label: 'Não sei', hint: 'Ainda não sei a minha parte' },
  2: { label: 'Mais ou menos', hint: 'Vou até o fim, mas com erros' },
  3: { label: 'Domino', hint: 'Toco até dormindo' },
};

export const TUNINGS = ['Padrão', 'Drop D', 'Meio tom abaixo (E♭)', 'Um tom abaixo (D)', 'Drop C♯', 'Drop C', 'DADGAD', 'Open G', 'Open D'];

export const MEMBER_COLORS = [
  { value: '#e08a2c', name: 'Âmbar' },
  { value: '#4f8ef7', name: 'Azul' },
  { value: '#d9508f', name: 'Rosa' },
  { value: '#3fb27f', name: 'Verde' },
  { value: '#9b6cf0', name: 'Roxo' },
  { value: '#e3c341', name: 'Amarelo' },
  { value: '#e25c4b', name: 'Vermelho' },
  { value: '#3cb6c9', name: 'Turquesa' },
];

export const isStandardTuning = (t: string) => !t || /^((e\s*)?standard|padr[aã]o)$/i.test(t.trim());
