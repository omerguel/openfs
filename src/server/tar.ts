/* ------------------------------------------------------------------ */
/* Minimal streaming tar (ustar + GNU long names) for backup archives. */
/*                                                                     */
/* Why tar and not the ZIP writer (zip.ts): a school's documents can   */
/* add up to gigabytes, and tar streams file by file from disk without */
/* holding anything in memory and without a 4 GB limit. The archives  */
/* open with `tar -xf`, 7-Zip and the macOS/Windows archive tools.     */
/* The reader accepts only regular files and directories (no links),   */
/* and refuses paths that would escape the target directory.           */
/* ------------------------------------------------------------------ */

import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, normalize, resolve, sep } from "node:path";

export type TarSource =
  | { name: string; path: string; size: number; mtime?: Date }
  | { name: string; data: Uint8Array; mtime?: Date };

const BLOCK = 512;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function octal(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

function header(name: string, size: number, mtime: Date, type: string): Uint8Array {
  const block = new Uint8Array(BLOCK);
  const put = (text: string, offset: number) => block.set(encoder.encode(text), offset);
  block.set(encoder.encode(name).subarray(0, 100), 0);
  put(octal(type === "5" ? 0o755 : 0o644, 8), 100);
  put(octal(0, 8), 108);
  put(octal(0, 8), 116);
  put(octal(size, 12), 124);
  put(octal(Math.floor(mtime.getTime() / 1000), 12), 136);
  put("        ", 148); // checksum placeholder
  put(type, 156);
  put("ustar\0", 257);
  put("00", 263);
  let sum = 0;
  for (const byte of block) sum += byte;
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return block;
}

function padding(size: number): Uint8Array {
  const rest = size % BLOCK;
  return new Uint8Array(rest === 0 ? 0 : BLOCK - rest);
}

function headersFor(name: string, size: number, mtime: Date): Uint8Array[] {
  const bytes = encoder.encode(name);
  if (bytes.length <= 100) return [header(name, size, mtime, "0")];
  // GNU long name: a pseudo entry carrying the full name first.
  const long = encoder.encode(`${name}\0`);
  return [
    header("././@LongLink", long.length, mtime, "L"),
    long,
    padding(long.length),
    header(name.slice(0, 100), size, mtime, "0"),
  ];
}

/** Streams the given files as a tar archive (files read lazily). */
export function tarStream(sources: TarSource[]): ReadableStream<Uint8Array> {
  async function* generate(): AsyncGenerator<Uint8Array> {
    for (const source of sources) {
      const mtime = source.mtime ?? new Date();
      if ("data" in source) {
        yield* headersFor(source.name, source.data.length, mtime);
        yield source.data;
        yield padding(source.data.length);
        continue;
      }
      yield* headersFor(source.name, source.size, mtime);
      let written = 0;
      for await (const chunk of Bun.file(source.path).stream()) {
        written += chunk.length;
        if (written > source.size) throw new Error(`${source.name}: Datei wurde größer.`);
        yield chunk;
      }
      if (written !== source.size)
        throw new Error(`${source.name}: Datei ist unvollständig.`);
      yield padding(source.size);
    }
    yield new Uint8Array(BLOCK * 2);
  }
  const iterator = generate();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // A pull that enqueues nothing would stall the stream: skip empties.
      for (;;) {
        const { value, done } = await iterator.next();
        if (done) return controller.close();
        if (value.length > 0) return controller.enqueue(value);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

class ByteReader {
  private chunks: Uint8Array[] = [];
  private buffered = 0;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private done = false;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  private async fill(min: number): Promise<void> {
    while (this.buffered < min && !this.done) {
      const { value, done } = await this.reader.read();
      if (done) this.done = true;
      else if (value.length > 0) {
        this.chunks.push(value);
        this.buffered += value.length;
      }
    }
  }

  /** Up to `max` bytes (at least 1 unless the stream ended). */
  async some(max: number): Promise<Uint8Array> {
    await this.fill(1);
    const first = this.chunks[0];
    if (!first) return new Uint8Array(0);
    if (first.length <= max) {
      this.chunks.shift();
      this.buffered -= first.length;
      return first;
    }
    this.chunks[0] = first.subarray(max);
    this.buffered -= max;
    return first.subarray(0, max);
  }

  /** Exactly `n` bytes, or null at the end of the stream. */
  async exactly(n: number): Promise<Uint8Array | null> {
    await this.fill(n);
    if (this.buffered < n) return null;
    const out = new Uint8Array(n);
    let offset = 0;
    while (offset < n) {
      const part = await this.some(n - offset);
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  async skip(n: number): Promise<void> {
    let left = n;
    while (left > 0) {
      const part = await this.some(left);
      if (part.length === 0) throw new Error("Archiv ist unvollständig.");
      left -= part.length;
    }
  }

  cancel() {
    void this.reader.cancel().catch(() => {});
  }
}

function text(block: Uint8Array, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return decoder.decode(end === -1 ? slice : slice.subarray(0, end));
}

function parseOctal(block: Uint8Array, offset: number, length: number): number {
  const raw = text(block, offset, length).trim();
  return raw ? Number.parseInt(raw, 8) : 0;
}

function checksumOk(block: Uint8Array): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : block[i]!;
  return sum === parseOctal(block, 148, 8);
}

/** Resolves an archive path inside `dest`; throws on anything unsafe. */
export function safeArchivePath(dest: string, name: string): string {
  const clean = name.replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (
    !clean ||
    isAbsolute(clean) ||
    clean.includes("\\") ||
    clean.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error(`Unzulässiger Pfad im Archiv: ${name}`);
  }
  const root = resolve(dest);
  const full = resolve(root, normalize(clean));
  if (!full.startsWith(root + sep))
    throw new Error(`Unzulässiger Pfad im Archiv: ${name}`);
  return full;
}

/** Extracts a tar stream into `dest`; returns the extracted file paths
 *  (relative, "/"-separated). Only regular files and directories. */
export async function extractTar(
  stream: ReadableStream<Uint8Array>,
  dest: string,
): Promise<string[]> {
  const input = new ByteReader(stream);
  const files: string[] = [];
  let longName: string | null = null;
  try {
    for (;;) {
      const block = await input.exactly(BLOCK);
      if (!block) throw new Error("Archiv ist unvollständig (Endmarke fehlt).");
      if (block.every((byte) => byte === 0)) break;
      if (!checksumOk(block)) throw new Error("Archiv ist beschädigt (Prüfsumme).");
      const size = parseOctal(block, 124, 12);
      const type = String.fromCharCode(block[156] || 48);
      const padded = Math.ceil(size / BLOCK) * BLOCK;
      const prefix = text(block, 345, 155);
      let name =
        longName ?? (prefix ? `${prefix}/${text(block, 0, 100)}` : text(block, 0, 100));
      longName = null;

      if (type === "L" || type === "x" || type === "g") {
        const data = await input.exactly(padded);
        if (!data) throw new Error("Archiv ist unvollständig.");
        const body = decoder.decode(data.subarray(0, size));
        if (type === "L") longName = body.replace(/\0.*$/s, "");
        if (type === "x") {
          const path = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body)?.[1];
          if (path) longName = path;
        }
        continue;
      }
      if (type === "5") {
        await mkdir(safeArchivePath(dest, name), { recursive: true });
        continue;
      }
      if (type !== "0") {
        throw new Error(`Nicht unterstützter Eintrag im Archiv (${type}): ${name}`);
      }
      name = name.replace(/^\.\/+/, "");
      const target = safeArchivePath(dest, name);
      await mkdir(dirname(target), { recursive: true });
      const sink = Bun.file(target).writer();
      let left = size;
      while (left > 0) {
        const part = await input.some(left);
        if (part.length === 0) throw new Error(`Archiv ist unvollständig: ${name}`);
        sink.write(part);
        left -= part.length;
      }
      await sink.end();
      await input.skip(padded - size);
      files.push(name);
    }
  } finally {
    input.cancel();
  }
  return files;
}

/** Writes a stream to a file chunk by chunk (Bun.write(path, Response)
 *  can stall on a stream that itself reads files). Returns the size. */
export async function saveStream(
  stream: ReadableStream<Uint8Array>,
  path: string,
): Promise<number> {
  await mkdir(dirname(path), { recursive: true });
  const sink = Bun.file(path).writer();
  let size = 0;
  for await (const chunk of stream) {
    sink.write(chunk);
    size += chunk.length;
  }
  await sink.end();
  return size;
}
