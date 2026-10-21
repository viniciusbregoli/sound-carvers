const LOCALE = 'pt-BR';

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Friendly total: "48 min", "1 h 12 min". */
export function formatRuntime(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${minutes / 60} h`;
}

/** Accepts "3:45", "3.45", "225" (seconds) or "4" (minutes when < 20). */
export function parseDuration(input: string): number | null | undefined {
  const value = input.trim();
  if (!value) return null;
  const parts = value.split(/[:.,]/);
  if (parts.length === 2 && parts.every((p) => /^\d+$/.test(p))) {
    const [m, s] = parts.map(Number);
    if (s >= 60) return undefined;
    return m * 60 + s || null;
  }
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    return n < 20 ? n * 60 : n;
  }
  return undefined;
}

const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

export function timeAgo(ms: number, now = Date.now()): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return 'agora mesmo';
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), 'day');
  if (abs < 365 * 86_400_000) return rtf.format(Math.round(diff / (30 * 86_400_000)), 'month');
  return rtf.format(Math.round(diff / (365 * 86_400_000)), 'year');
}

/** Short "rehearsed" label for cards: "hoje", "há 3 dias", "há 2 sem.", "há 5 meses". */
export function shortAgo(ms: number, now = Date.now()): string {
  const days = Math.floor((startOfDay(now) - startOfDay(ms)) / 86_400_000);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 14) return `há ${days} dias`;
  if (days < 60) return `há ${Math.floor(days / 7)} sem.`;
  const months = Math.floor(days / 30);
  return `há ${months} ${months === 1 ? 'mês' : 'meses'}`;
}

function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function isToday(ms: number) {
  return startOfDay(ms) === startOfDay(Date.now());
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDate(iso: string | null, opts: { weekday?: boolean; year?: boolean } = {}): string {
  if (!iso) return 'Sem data';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(LOCALE, {
    weekday: opts.weekday === false ? undefined : 'short',
    month: 'short',
    day: 'numeric',
    year: opts.year || !sameYear ? 'numeric' : undefined,
  });
}

export function formatDay(ms: number) {
  return new Date(ms).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
}

/** "daqui a 3 dias", "amanhã", "hoje", "há 2 semanas" for a calendar date. */
export function relativeDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const days = Math.round((target - startOfDay(Date.now())) / 86_400_000);
  if (Math.abs(days) < 14) return rtf.format(days, 'day');
  if (Math.abs(days) < 60) return rtf.format(Math.round(days / 7), 'week');
  return rtf.format(Math.round(days / 30), 'month');
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts.at(-1)![0] : (parts[0]?.[1] ?? ''))).toUpperCase();
}

/** Splits quick-add text like "Tempo Perdido - Legião Urbana". */
export function splitTitleArtist(input: string): { title: string; artist: string } {
  const match = input.match(/^(.*?)\s+[-–—]\s+(.+)$/);
  if (match) return { title: match[1].trim(), artist: match[2].trim() };
  return { title: input.trim(), artist: '' };
}

/** plural(3, 'música') → "3 músicas"; irregular forms via `many`. */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
