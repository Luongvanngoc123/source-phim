/*
 * Serves the video files of the backup server to this site's player.
 *
 * Those files are whole MP4s on a storage host that only answers a request coming from the
 * player they belong to, they are cut into parts of a fixed size, and the first 64 KiB of the
 * first part is scrambled. A <video> element can do none of that, so every byte it asks for
 * goes through this worker: it picks the part, asks the host for that stretch and unscrambles
 * what has to be. Nothing is stored; the bytes stream through.
 */

const MEDIA_PREFIX = "/hdx/";
/** Path the storage host wants to see a request come from. */
const MEDIA_REFERRER = "/hdx/abyssplayer.com/";
const KEY_PATTERN = /^[0-9a-f]{32}$/;
const RANGE_PATTERN = /^bytes=(\d+)-(\d*)$/;

/** Which stretch of which part answers one request. */
function planRequest(start, end, size, partSize) {
  const part = Math.floor(start / partSize);
  const partStart = part * partSize;
  const partEnd = Math.min(size, partStart + partSize) - 1;
  const last = Math.min(end, partEnd);
  return {
    part,
    partStart,
    end: last,
    upstreamStart: start - partStart,
    upstreamEnd: last - partStart,
  };
}

/** The URL of one part: the first is the file itself, the rest carry their number. */
function partUrl(url, part) {
  return part === 0 ? url : `${url}${part}`;
}

/**
 * Unscramble `chunk`, which starts at `offset` in the file, in place.
 *
 * The scrambling is a stream cipher, so each byte is undone with the keystream byte at its
 * own position and a chunk may start anywhere, including across the end of the scrambled head.
 */
function unscramble(chunk, offset, keystream) {
  const limit = Math.min(chunk.length, keystream.length - offset);
  for (let i = 0; i < limit; i += 1) {
    chunk[i] ^= keystream[offset + i];
  }
  return chunk;
}

/** Bytes 4 to 8 of an MP4 name its type; a file that already reads as one is not scrambled. */
function looksLikeMp4(head) {
  return (
    head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70
  );
}

const keystreams = new Map();
const plainFiles = new Map();

function keystreamFor(keyHex, length) {
  let pending = keystreams.get(keyHex);
  if (!pending) {
    pending = (async () => {
      const encoder = new TextEncoder();
      const raw = encoder.encode(keyHex);
      const key = await crypto.subtle.importKey("raw", raw, { name: "AES-CTR" }, false, [
        "encrypt",
      ]);
      const counter = raw.slice(0, 16);
      const out = await crypto.subtle.encrypt(
        { name: "AES-CTR", counter, length: 128 },
        key,
        new Uint8Array(length),
      );
      return new Uint8Array(out);
    })();
    keystreams.set(keyHex, pending);
  }
  return pending;
}

function fetchPart(url, rangeStart, rangeEnd, signal) {
  return fetch(url, {
    headers: { Range: `bytes=${rangeStart}-${rangeEnd}` },
    mode: "cors",
    credentials: "omit",
    referrer: MEDIA_REFERRER,
    referrerPolicy: "unsafe-url",
    signal,
  });
}

/** Whether the first part of this file is scrambled at all. */
async function isScrambled(url) {
  let pending = plainFiles.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetchPart(url, 0, 7);
      if (!response.ok) return true;
      return !looksLikeMp4(new Uint8Array(await response.arrayBuffer()));
    })();
    plainFiles.set(url, pending);
  }
  return pending;
}

async function serve(request, url) {
  const media = url.searchParams.get("u");
  const size = Number(url.searchParams.get("s"));
  const partSize = Number(url.searchParams.get("p"));
  const key = url.searchParams.get("k");
  const head = Number(url.searchParams.get("h") || 65536);
  const valid =
    media &&
    media.startsWith("https://") &&
    Number.isSafeInteger(size) &&
    size > 0 &&
    Number.isSafeInteger(partSize) &&
    partSize > 0 &&
    partSize <= size &&
    KEY_PATTERN.test(key || "") &&
    Number.isSafeInteger(head) &&
    head > 0;
  if (!valid) return new Response(null, { status: 400 });

  const requested = RANGE_PATTERN.exec(request.headers.get("range") || "bytes=0-");
  if (!requested) return new Response(null, { status: 416 });
  const start = Number(requested[1]);
  if (start >= size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const end = requested[2] ? Math.min(Number(requested[2]), size - 1) : size - 1;
  if (end < start) return new Response(null, { status: 416 });

  const plan = planRequest(start, end, size, partSize);
  const controller = new AbortController();
  const response = await fetchPart(
    partUrl(media, plan.part),
    plan.upstreamStart,
    plan.upstreamEnd,
    controller.signal,
  );
  if (response.status !== 206 || !response.body) {
    return new Response(null, { status: 502 });
  }

  let body = response.body;
  if (plan.part === 0 && start < head && (await isScrambled(media))) {
    const keystream = await keystreamFor(key, head);
    let offset = start;
    body = body.pipeThrough(
      new TransformStream({
        transform(chunk, target) {
          if (offset < head) {
            const copy = new Uint8Array(chunk);
            unscramble(copy, offset, keystream);
            chunk = copy;
          }
          offset += chunk.length;
          target.enqueue(chunk);
        },
      }),
    );
  }

  return new Response(body, {
    status: 206,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Range": `bytes ${start}-${plan.end}/${size}`,
      "Content-Length": String(plan.end - start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

self.addEventListener("install", (event) => {
  // Everything but the media path keeps going straight to the network, so pages and data
  // never wait for this worker.
  if (event.addRoutes && typeof URLPattern === "function") {
    try {
      event.addRoutes([
        {
          condition: { urlPattern: new URLPattern({ pathname: "/hdx/*" }) },
          source: "fetch-event",
        },
        { condition: { urlPattern: new URLPattern({}) }, source: "network" },
      ]);
    } catch {
      // An older browser keeps the plain fetch handler below.
    }
  }
  self.skipWaiting();
});

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "claim") {
    event.waitUntil(self.clients.claim());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode === "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(MEDIA_PREFIX)) return;
  event.respondWith(serve(request, url).catch(() => new Response(null, { status: 502 })));
});

// The parts a test can reach without a browser.
self.__hdx = { planRequest, partUrl, unscramble, looksLikeMp4 };
