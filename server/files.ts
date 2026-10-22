import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

export const FILE_KINDS = ['audio', 'image'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** The only types we store and serve back; anything else (SVG, HTML, video…) is refused. */
const TYPES: Record<string, { kind: FileKind; ext: string }> = {
  'audio/mpeg': { kind: 'audio', ext: 'mp3' },
  'audio/mp3': { kind: 'audio', ext: 'mp3' },
  'audio/mp4': { kind: 'audio', ext: 'm4a' },
  'audio/x-m4a': { kind: 'audio', ext: 'm4a' },
  'audio/aac': { kind: 'audio', ext: 'aac' },
  'audio/wav': { kind: 'audio', ext: 'wav' },
  'audio/x-wav': { kind: 'audio', ext: 'wav' },
  'audio/wave': { kind: 'audio', ext: 'wav' },
  'audio/ogg': { kind: 'audio', ext: 'ogg' },
  'audio/opus': { kind: 'audio', ext: 'opus' },
  'audio/webm': { kind: 'audio', ext: 'webm' },
  'audio/flac': { kind: 'audio', ext: 'flac' },
  'audio/x-flac': { kind: 'audio', ext: 'flac' },
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/png': { kind: 'image', ext: 'png' },
  'image/webp': { kind: 'image', ext: 'webp' },
  'image/gif': { kind: 'image', ext: 'gif' },
};

export const MAX_BYTES: Record<FileKind, number> = { audio: 60_000_000, image: 15_000_000 };

export function uploadType(contentType: string) {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  const type = TYPES[mime];
  return type ? { mime, ...type } : null;
}

export const isStoredFile = (file: string) => /^[0-9a-f-]{36}\.[a-z0-9]{2,4}$/.test(file);

export class TooLarge extends Error {}

/** Band uploads (rehearsal recordings, photos of charts) on disk, named by random id. */
export function createFiles(dir: string) {
  mkdirSync(dir, { recursive: true });
  const pathOf = (file: string) => join(dir, file);

  /** Streams a request body to disk, giving up (and cleaning up) past `max` bytes. */
  async function save(body: ReadableStream<Uint8Array>, ext: string, max: number) {
    const file = `${randomUUID()}.${ext}`;
    const path = pathOf(file);
    const out = createWriteStream(path, { flags: 'wx' });
    let size = 0;
    try {
      for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > max) throw new TooLarge();
        if (!out.write(chunk)) await once(out, 'drain');
      }
      out.end();
      await once(out, 'finish');
    } catch (err) {
      // The file opens asynchronously; wait for the stream to close or the open would recreate it after the rm.
      out.destroy();
      if (!out.closed) await once(out, 'close');
      rmSync(path, { force: true });
      throw err;
    }
    return { file, size };
  }

  /** The whole file, or one byte range of it: Safari won't play audio from a server without ranges. */
  function read(file: string, range: string | undefined) {
    const { size } = statSync(pathOf(file));
    let start = 0;
    let end = size - 1;
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
    if (m && (m[1] || m[2])) {
      if (m[1]) {
        start = Number(m[1]);
        if (m[2]) end = Math.min(Number(m[2]), size - 1);
      } else {
        start = Math.max(0, size - Number(m[2]));
      }
      if (start > end) return { status: 416 as const, size };
    }
    const stream = Readable.toWeb(createReadStream(pathOf(file), { start, end })) as ReadableStream<Uint8Array>;
    return { status: m && (m[1] || m[2]) ? (206 as const) : (200 as const), size, start, end, stream };
  }

  function remove(file: string | null | undefined) {
    if (file && isStoredFile(file)) rmSync(pathOf(file), { force: true });
  }

  return { save, read, remove };
}

export type Files = ReturnType<typeof createFiles>;
