import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

export const FILE_KINDS = ['audio', 'image'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** Declared types we let through to the upload; the stored type always comes from the bytes (see `sniff`). */
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

const ascii = (b: Uint8Array, at: number, text: string) => [...text].every((ch, i) => b[at + i] === ch.charCodeAt(0));

/**
 * The real format, from the first bytes. A mislabeled or disguised upload (HTML sent as audio/mpeg…) is refused,
 * and what we store and serve back is what the file actually is.
 */
export function sniff(b: Uint8Array): { kind: FileKind; mime: string; ext: string } | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (b[0] === 0x89 && ascii(b, 1, 'PNG')) return { kind: 'image', mime: 'image/png', ext: 'png' };
  if (ascii(b, 0, 'GIF8')) return { kind: 'image', mime: 'image/gif', ext: 'gif' };
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return { kind: 'image', mime: 'image/webp', ext: 'webp' };
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) return { kind: 'audio', mime: 'audio/wav', ext: 'wav' };
  if (ascii(b, 0, 'ID3')) return { kind: 'audio', mime: 'audio/mpeg', ext: 'mp3' };
  if (ascii(b, 4, 'ftyp')) return { kind: 'audio', mime: 'audio/mp4', ext: 'm4a' };
  if (ascii(b, 0, 'OggS')) return { kind: 'audio', mime: 'audio/ogg', ext: 'ogg' };
  if (ascii(b, 0, 'fLaC')) return { kind: 'audio', mime: 'audio/flac', ext: 'flac' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'audio', mime: 'audio/webm', ext: 'webm' };
  // Raw frames without a container: AAC (ADTS) first, since its sync word is a special case of MPEG audio's.
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return { kind: 'audio', mime: 'audio/aac', ext: 'aac' };
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) return { kind: 'audio', mime: 'audio/mpeg', ext: 'mp3' };
  return null;
}

export const isStoredFile = (file: string) => /^[0-9a-f-]{36}\.[a-z0-9]{2,4}$/.test(file);

export class TooLarge extends Error {}
export class EmptyUpload extends Error {}
/** The bytes aren't a format we take, or not the kind (audio/image) the upload claimed. */
export class NotMedia extends Error {}

/** Band uploads (rehearsal recordings, photos of charts) on disk, named by random id. */
export function createFiles(dir: string) {
  mkdirSync(dir, { recursive: true });
  const pathOf = (file: string) => join(dir, file);

  /**
   * Streams a request body to disk, giving up (and cleaning up) past `max` bytes, then checks the first bytes
   * really are `kind` media and names the file after the detected format.
   */
  async function save(body: ReadableStream<Uint8Array>, kind: FileKind, max: number) {
    const id = randomUUID();
    const path = pathOf(`${id}.part`);
    const out = createWriteStream(path, { flags: 'wx' });
    // A write error (disk full…) can fire while we wait for the next chunk, when nothing else is listening;
    // unhandled, it would crash the process. Keep it and throw it at the next step instead.
    let failure: Error | undefined;
    out.on('error', (err) => {
      failure = err;
    });
    let size = 0;
    let head = Buffer.alloc(0);
    try {
      for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
        if (failure) throw failure;
        if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
        size += chunk.byteLength;
        if (size > max) throw new TooLarge();
        if (!out.write(chunk)) await once(out, 'drain');
      }
      if (failure) throw failure;
      out.end();
      await once(out, 'finish');
    } catch (err) {
      // The file opens asynchronously; wait for the stream to close or the open would recreate it after the rm.
      out.destroy();
      if (!out.closed) await once(out, 'close');
      rmSync(path, { force: true });
      throw err;
    }
    const type = sniff(head);
    if (!size || type?.kind !== kind) {
      rmSync(path, { force: true });
      throw size ? new NotMedia() : new EmptyUpload();
    }
    const file = `${id}.${type.ext}`;
    renameSync(path, pathOf(file));
    return { file, size, mime: type.mime };
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
