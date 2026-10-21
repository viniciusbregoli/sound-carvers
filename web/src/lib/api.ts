/** Identifies this tab, so realtime events caused by our own writes don't trigger a refetch. */
export const clientId = crypto.randomUUID();

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = { ok: true }>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-client-id': clientId },
      body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Não foi possível falar com o servidor. Confira sua conexão e tente de novo.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `A requisição falhou (${res.status}). Tente de novo.`, res.status);
  return data as T;
}

/** Proxied URL for suggestion artwork (the page never loads third-party images directly). */
export const artUrl = (url: string | null) => (url ? `/api/art?u=${encodeURIComponent(url)}` : null);
