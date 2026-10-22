export class BadRequest extends Error {}

const LABELS: Record<string, string> = {
  title: 'título', artist: 'artista', name: 'nome', instrument: 'instrumento', color: 'cor', key: 'tom', bpm: 'andamento',
  duration: 'duração', tuning: 'afinação', notes: 'anotações', links: 'links', status: 'coluna', index: 'posição',
  date: 'data', time: 'horário', venue: 'local', kind: 'tipo', level: 'avaliação', text: 'texto', label: 'nome do link',
  url: 'endereço', memberId: 'integrante', songId: 'música', at: 'data do ensaio', deezerId: 'faixa', role: 'função', body: 'texto',
};
const label = (key: string) => LABELS[key] ?? key;

type Obj = Record<string, unknown>;

export function obj(value: unknown): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequest('Requisição malformada');
  return value as Obj;
}

export function str(o: Obj, key: string, max: number, opts: { required?: boolean } = {}): string | undefined {
  const v = o[key];
  if (v === undefined) {
    if (opts.required) throw new BadRequest(`Preencha o campo ${label(key)}`);
    return undefined;
  }
  if (typeof v !== 'string') throw new BadRequest(`O campo ${label(key)} precisa ser texto`);
  const trimmed = v.trim();
  if (opts.required && !trimmed) throw new BadRequest(`Preencha o campo ${label(key)}`);
  if (trimmed.length > max) throw new BadRequest(`O campo ${label(key)} passou do limite de ${max} caracteres`);
  return trimmed;
}

/** Text that keeps its line breaks and inner spacing (notes). */
export function text(o: Obj, key: string, max: number): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new BadRequest(`O campo ${label(key)} precisa ser texto`);
  if (v.length > max) throw new BadRequest(`O campo ${label(key)} passou do limite de ${max} caracteres`);
  return v;
}

export function int(o: Obj, key: string, min: number, max: number): number | null | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new BadRequest(`O campo ${label(key)} precisa ser um número inteiro entre ${min} e ${max}`);
  }
  return v;
}

export function oneOf<T extends string>(o: Obj, key: string, values: readonly T[]): T | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !values.includes(v as T)) throw new BadRequest(`Valor inválido para ${label(key)}`);
  return v as T;
}

export function bool(o: Obj, key: string): boolean | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new BadRequest(`Valor inválido para ${label(key)}`);
  return v;
}

export function date(o: Obj, key: string): string | null | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw new BadRequest(`O campo ${label(key)} precisa ser uma data válida`);
  }
  return v;
}

export function time(o: Obj, key: string): string | null | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new BadRequest(`O campo ${label(key)} precisa ser um horário (HH:MM)`);
  return v;
}

export function color(o: Obj, key: string): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) throw new BadRequest('Escolha uma das cores');
  return v.toLowerCase();
}

export type Link = { label: string; url: string };

export function links(o: Obj, key: string): Link[] | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 12) throw new BadRequest('Cada música aceita até 12 links');
  return v.map((item) => {
    const l = obj(item);
    const url = str(l, 'url', 2000, { required: true })!;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequest(`“${url}” não é um link válido. Cole o endereço completo, como https://youtu.be/…`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new BadRequest('Links precisam começar com http:// ou https://');
    return { label: str(l, 'label', 60) ?? '', url: parsed.toString() };
  });
}
