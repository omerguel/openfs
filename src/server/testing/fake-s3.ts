/* ------------------------------------------------------------------ */
/* Test double for Bun's S3Client (the S3ClientLike subset) — keeps    */
/* the S3 code paths testable without any network access.              */
/* ------------------------------------------------------------------ */

import type { S3ClientLike } from "../file-store";

/** In-memory stand-in with the S3Client surface the stores use. */
export class FakeS3Client implements S3ClientLike {
  readonly objects = new Map<string, { bytes: Uint8Array; type?: string }>();
  failWrites = false;

  async write(key: string, data: Uint8Array | Blob, options?: { type?: string }) {
    if (this.failWrites) throw new Error("S3 nicht erreichbar");
    const bytes =
      data instanceof Uint8Array
        ? new Uint8Array(data)
        : new Uint8Array(await data.arrayBuffer());
    this.objects.set(key, { bytes, type: options?.type });
    return bytes.byteLength;
  }

  file(key: string) {
    const object = this.objects.get(key);
    return {
      exists: async () => object !== undefined,
      arrayBuffer: async () => {
        if (!object) throw new Error("NoSuchKey");
        return object.bytes.slice().buffer;
      },
    };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async list(input?: { prefix?: string; startAfter?: string; maxKeys?: number }) {
    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(input?.prefix ?? ""))
      .filter((key) => !input?.startAfter || key > input.startAfter)
      .sort();
    const max = input?.maxKeys ?? 1000;
    return {
      contents: keys
        .slice(0, max)
        .map((key) => ({ key, size: this.objects.get(key)!.bytes.byteLength })),
      isTruncated: keys.length > max,
    };
  }
}
