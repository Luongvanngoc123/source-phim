import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

interface WorkerHooks {
  planRequest(
    start: number,
    end: number,
    size: number,
    partSize: number,
  ): { part: number; end: number; upstreamStart: number; upstreamEnd: number };
  partUrl(url: string, part: number): string;
  unscramble(chunk: Uint8Array, offset: number, keystream: Uint8Array): Uint8Array;
  looksLikeMp4(head: Uint8Array): boolean;
}

/** Runs the worker file the way a browser would, with just enough of a worker scope. */
function loadWorker(): WorkerHooks {
  const scope: Record<string, unknown> = {
    addEventListener() {},
    location: { origin: "https://phim.example" },
  };
  scope.self = scope;
  const source = readFileSync(new URL("../public/hdx-sw.js", import.meta.url), "utf8");
  vm.runInNewContext(source, scope);
  return scope.__hdx as WorkerHooks;
}

const hdx = loadWorker();

test("a request is answered from the one part that holds its first byte", () => {
  // A whole file is a single part.
  // The worker runs in its own realm; spreading gives an object of this one to compare.
  assert.deepEqual(
    { ...hdx.planRequest(0, 99, 100, 100) },
    {
      part: 0,
      partStart: 0,
      end: 99,
      upstreamStart: 0,
      upstreamEnd: 99,
    },
  );
  // An open-ended request stops where the part stops; the browser asks again for the rest.
  const split = hdx.planRequest(0, 249, 250, 100);
  assert.equal(split.end, 99);
  const second = hdx.planRequest(130, 249, 250, 100);
  assert.deepEqual(
    [second.part, second.upstreamStart, second.upstreamEnd, second.end],
    [1, 30, 99, 199],
  );
  // The last part is shorter than the others.
  const last = hdx.planRequest(205, 249, 250, 100);
  assert.deepEqual([last.part, last.upstreamStart, last.upstreamEnd, last.end], [2, 5, 49, 249]);
  assert.equal(hdx.partUrl("https://cdn.example/f.5", 0), "https://cdn.example/f.5");
  assert.equal(hdx.partUrl("https://cdn.example/f.5", 1), "https://cdn.example/f.51");
});

test("the scrambled head comes back as the bytes the player decrypts", () => {
  const head = 65536;
  const key = createHash("md5").update("ad14fc01f0c8fc4439df1fad8afae.131941583.3").digest("hex");
  const plain = new Uint8Array(head + 5000);
  for (let i = 0; i < plain.length; i += 1) plain[i] = (i * 31 + 7) & 0xff;
  const cipher = createCipheriv("aes-256-ctr", Buffer.from(key), Buffer.from(key.slice(0, 16)));
  const scrambled = new Uint8Array(plain);
  scrambled.set(cipher.update(plain.subarray(0, head)), 0);
  const keystreamCipher = createCipheriv(
    "aes-256-ctr",
    Buffer.from(key),
    Buffer.from(key.slice(0, 16)),
  );
  const keystream = new Uint8Array(keystreamCipher.update(new Uint8Array(head)));

  for (const start of [0, 13, 65530, 70000]) {
    const chunk = scrambled.slice(start, start + 400);
    hdx.unscramble(chunk, start, keystream);
    assert.deepEqual(chunk, plain.slice(start, start + 400), `start ${start}`);
  }
});

test("a file that already reads as an MP4 is recognised as not scrambled", () => {
  const ftyp = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]);
  assert.equal(hdx.looksLikeMp4(ftyp), true);
  assert.equal(
    hdx.looksLikeMp4(new Uint8Array([0x14, 0x08, 0x70, 0x6e, 0x5d, 0xe4, 0x96, 0x66])),
    false,
  );
});
