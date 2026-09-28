/* Streaming tar: round trip (incl. long names), compatibility with the
   system tar, and refusal of unsafe archives. */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractTar, safeArchivePath, tarStream } from "./tar";

const root = mkdtempSync(join(tmpdir(), "openfs-tar-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let seq = 0;
const fresh = () => join(root, `t${++seq}`);

const bytes = (n: number, seed = 1) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + seed) & 0xff;
  return out;
};

async function toBytes(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function streamOf(data: Uint8Array, chunk = 700) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= data.length) return controller.close();
      controller.enqueue(data.subarray(offset, offset + chunk));
      offset += chunk;
    },
  });
}

describe("tar", () => {
  test("round trip with disk files, in-memory data and a long name", async () => {
    const src = fresh();
    const dest = fresh();
    const big = bytes(100_000, 7);
    writeFileSync(join(root, `big-${seq}.bin`), big);
    const longName = `set/files/students/12/legacy-${"x".repeat(64)}-${"a".repeat(16)}`;
    const archive = await toBytes(
      tarStream([
        { name: "set/manifest.json", data: new TextEncoder().encode('{"a":1}') },
        {
          name: "set/files/big.bin",
          path: join(root, `big-${seq}.bin`),
          size: big.length,
        },
        { name: longName, data: bytes(513, 3) },
        { name: "set/empty", data: new Uint8Array(0) },
      ]),
    );
    expect(archive.length % 512).toBe(0);
    // Odd chunk sizes exercise the buffering.
    const names = await extractTar(streamOf(archive), dest);
    expect(names).toEqual([
      "set/manifest.json",
      "set/files/big.bin",
      longName,
      "set/empty",
    ]);
    expect(readFileSync(join(dest, "set/files/big.bin"))).toEqual(Buffer.from(big));
    expect(readFileSync(join(dest, longName))).toEqual(Buffer.from(bytes(513, 3)));
    expect(readFileSync(join(dest, "set/empty")).length).toBe(0);
    rmSync(src, { recursive: true, force: true });
  });

  test("the system tar reads our archives and we read its archives", async () => {
    const dir = fresh();
    const archive = join(root, `sys-${seq}.tar`);
    await Bun.write(
      archive,
      await toBytes(
        tarStream([
          { name: "a/b.txt", data: new TextEncoder().encode("hallo") },
          { name: `a/${"l".repeat(120)}.txt`, data: new TextEncoder().encode("lang") },
        ]),
      ),
    );
    const listed = Bun.spawnSync(["tar", "-tf", archive])
      .stdout.toString()
      .trim()
      .split("\n");
    expect(listed).toEqual(["a/b.txt", `a/${"l".repeat(120)}.txt`]);

    // An archive made by the system tar (directories + a long name).
    const tree = fresh();
    await Bun.write(join(tree, "x", "y.txt"), "von tar");
    await Bun.write(join(tree, "x", `${"z".repeat(130)}.txt`), "lang");
    const made = join(root, `made-${seq}.tar`);
    expect(Bun.spawnSync(["tar", "-cf", made, "-C", tree, "x"]).exitCode).toBe(0);
    const names = await extractTar(Bun.file(made).stream(), dir);
    expect(names.sort()).toEqual(["x/y.txt", `x/${"z".repeat(130)}.txt`]);
    expect(readFileSync(join(dir, "x/y.txt"), "utf8")).toBe("von tar");
  });

  test("refuses path traversal, absolute paths, links and truncated archives", async () => {
    for (const name of ["../evil", "/etc/passwd", "a/../../evil", "a//b"]) {
      expect(() => safeArchivePath(root, name)).toThrow();
    }
    const evil = await toBytes(
      tarStream([{ name: "../evil.txt", data: new TextEncoder().encode("x") }]),
    );
    await expect(extractTar(streamOf(evil), fresh())).rejects.toThrow("Unzulässiger");

    // A symlink entry made by the system tar.
    const tree = fresh();
    await Bun.write(join(tree, "t.txt"), "x");
    Bun.spawnSync(["ln", "-s", "/etc/passwd", join(tree, "link")]);
    const withLink = join(root, `link-${seq}.tar`);
    Bun.spawnSync(["tar", "-cf", withLink, "-C", tree, "link"]);
    await expect(extractTar(Bun.file(withLink).stream(), fresh())).rejects.toThrow(
      "Nicht unterstützt",
    );

    const good = await toBytes(tarStream([{ name: "a.txt", data: bytes(2000) }]));
    await expect(extractTar(streamOf(good.subarray(0, 1024)), fresh())).rejects.toThrow(
      "unvollständig",
    );
    const corrupt = new Uint8Array(good);
    corrupt[10] = 0x41;
    await expect(extractTar(streamOf(corrupt), fresh())).rejects.toThrow("Prüfsumme");
  });
});
