/* ------------------------------------------------------------------ */
/* FileStore implementations: disk (temp dir), memory, S3 (fake client */
/* — no network) and the env-based factory.                            */
/* ------------------------------------------------------------------ */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertValidKey,
  createFileStoreFromEnv,
  DiskFileStore,
  type FileStore,
  MemoryFileStore,
  S3FileStore,
  s3ConfigFromEnv,
} from "./file-store";
import { FakeS3Client } from "./testing/fake-s3";

const tempDir = mkdtempSync(join(tmpdir(), "openfs-files-"));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

const bytes = (text: string) => new TextEncoder().encode(text);

function contract(name: string, make: () => FileStore) {
  describe(`${name} — FileStore contract`, () => {
    test("put → get returns the same bytes", async () => {
      const store = make();
      await store.put("students/1/a", bytes("hallo"), "text/plain");
      expect(new TextDecoder().decode((await store.get("students/1/a"))!)).toBe("hallo");
    });

    test("get of an unknown key → null", async () => {
      expect(await make().get("students/1/missing")).toBeNull();
    });

    test("put overwrites, delete removes, deleting twice is fine", async () => {
      const store = make();
      await store.put("students/2/b", bytes("eins"), "text/plain");
      await store.put("students/2/b", bytes("zwei"), "text/plain");
      expect(new TextDecoder().decode((await store.get("students/2/b"))!)).toBe("zwei");
      await store.delete("students/2/b");
      await store.delete("students/2/b");
      expect(await store.get("students/2/b")).toBeNull();
    });

    test("rejects traversal keys", async () => {
      const store = make();
      await expect(store.put("../evil", bytes("x"), "text/plain")).rejects.toThrow();
      await expect(store.put("a/../../evil", bytes("x"), "text/plain")).rejects.toThrow();
      await expect(store.put("/abs", bytes("x"), "text/plain")).rejects.toThrow();
    });
  });
}

contract("MemoryFileStore", () => new MemoryFileStore());
contract("DiskFileStore", () => new DiskFileStore(join(tempDir, "disk")));
contract("S3FileStore", () => new S3FileStore(new FakeS3Client(), "openfs/files/"));

describe("DiskFileStore", () => {
  test("creates nested directories on demand under its root", async () => {
    const dir = join(tempDir, "nested");
    const store = new DiskFileStore(dir);
    await store.put("students/9/x", bytes("x"), "application/pdf");
    expect(await Bun.file(join(dir, "students", "9", "x")).exists()).toBe(true);
  });
});

describe("S3FileStore", () => {
  test("prefixes object keys and passes the content type", async () => {
    const client = new FakeS3Client();
    const store = new S3FileStore(client, "schule/files/");
    await store.put("students/1/k", bytes("pdf"), "application/pdf");
    expect(client.objects.get("schule/files/students/1/k")?.type).toBe("application/pdf");
  });
});

describe("assertValidKey", () => {
  test("accepts server-generated keys", () => {
    expect(() => assertValidKey("students/12/0b8f-uuid")).not.toThrow();
    expect(() => assertValidKey("students/12/legacy-abc-0123")).not.toThrow();
  });

  test("rejects empty, dot and backslash keys", () => {
    for (const key of ["", ".", "..", "a/./b", "a\\b", "a//b"]) {
      expect(() => assertValidKey(key)).toThrow();
    }
  });
});

describe("s3ConfigFromEnv / createFileStoreFromEnv", () => {
  const s3Env = {
    S3_ENDPOINT: "https://fsn1.your-objectstorage.com",
    S3_BUCKET: "fahrschule",
    S3_ACCESS_KEY_ID: "key",
    S3_SECRET_ACCESS_KEY: "secret",
    S3_PREFIX: "/muster",
  };

  test("null unless all required variables are set", () => {
    expect(s3ConfigFromEnv({})).toBeNull();
    expect(s3ConfigFromEnv({ ...s3Env, S3_BUCKET: "" })).toBeNull();
  });

  test("normalizes the prefix to end with a slash", () => {
    expect(s3ConfigFromEnv(s3Env)?.prefix).toBe("muster/");
    expect(s3ConfigFromEnv({ ...s3Env, S3_PREFIX: undefined })?.prefix).toBe("");
  });

  test("demo mode → memory, S3 env → s3, otherwise disk", () => {
    expect(createFileStoreFromEnv({ demoMode: true, env: s3Env }).kind).toBe("memory");
    expect(createFileStoreFromEnv({ demoMode: false, env: s3Env }).kind).toBe("s3");
    const disk = createFileStoreFromEnv({
      demoMode: false,
      env: { FILE_STORE_DIR: join(tempDir, "env") },
    });
    expect(disk.kind).toBe("disk");
    expect(disk.store).toBeInstanceOf(DiskFileStore);
  });
});
