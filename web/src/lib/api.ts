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

/** Sends a file as the raw request body; XHR rather than fetch, for upload progress. */
export function upload<T>(path: string, file: Blob, type: string, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.setRequestHeader('content-type', type);
    xhr.setRequestHeader('x-client-id', clientId);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      const data = xhr.response ?? {};
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(data.error ?? `O envio falhou (${xhr.status}). Tente de novo.`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Não foi possível enviar o arquivo. Confira sua conexão e tente de novo.', 0));
    xhr.send(file);
  });
}
