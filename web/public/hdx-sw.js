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
const MAX_OPEN_RANGE = 4 * 1024 * 1024;

function resolveRange(rangeHeader, size, maxOpenRange = MAX_OPEN_RANGE) {
  const requested = RANGE_PATTERN.exec(rangeHeader || "bytes=0-");
  if (!requested) return null;
  const start = Number(requested[1]);
  if (start >= size) return null;
  const end = requested[2]
    ? Math.min(Number(requested[2]), size - 1)
    : Math.min(start + maxOpenRange - 1, size - 1);
  return end < start ? null : { start, end };
}

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

function setBounded(map, key, value, limit = 64) {
  if (map.has(key)) map.delete(key);
  else if (map.size >= limit) map.delete(map.keys().next().value);
  map.set(key, value);
  return value;
}

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
    setBounded(keystreams, keyHex, pending);
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

async function fetchPartWithRetry(url, rangeStart, rangeEnd, signal) {
  let response;
  try {
    response = await fetchPart(url, rangeStart, rangeEnd, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    return fetchPart(url, rangeStart, rangeEnd, signal);
  }
  if (response.status < 500 || signal?.aborted) return response;
  try {
    await response.body?.cancel();
  } catch {
    // The retry is still useful if the failed response cannot be cancelled.
  }
  return fetchPart(url, rangeStart, rangeEnd, signal);
}

function createHeadTransform({ start, head, keystreamPromise, scrambled, onDetected }) {
  let state = scrambled;
  let offset = start;
  let key;
  let buffered = [];
  let bufferedLength = 0;
  const pendingKeystream = keystreamPromise || Promise.resolve(new Uint8Array());

  async function processChunk(chunk, target) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    const headLength = state === true ? Math.max(0, Math.min(bytes.length, head - offset)) : 0;
    if (headLength === 0) {
      target.enqueue(chunk);
    } else {
      key = key || (await pendingKeystream);
      const copy = new Uint8Array(headLength);
      copy.set(bytes.subarray(0, headLength));
      unscramble(copy, offset, key);
      target.enqueue(copy);
      if (headLength < bytes.length) target.enqueue(bytes.subarray(headLength));
    }
    offset += bytes.length;
  }

  async function detect(target) {
    const original = buffered;
    const probe = new Uint8Array(Math.min(bufferedLength, 8));
    let probeOffset = 0;
    for (const chunk of original) {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      const copied = Math.min(bytes.length, probe.length - probeOffset);
      probe.set(bytes.subarray(0, copied), probeOffset);
      probeOffset += copied;
      if (probeOffset === probe.length) break;
    }
    state = !looksLikeMp4(probe);
    if (onDetected && probe.length >= 8) onDetected(state);
    buffered = [];
    bufferedLength = 0;
    for (const chunk of original) await processChunk(chunk, target);
  }

  return new TransformStream({
    async transform(chunk, target) {
      if (state === null) {
        buffered.push(chunk);
        bufferedLength += chunk.byteLength ?? chunk.length;
        if (bufferedLength < 8) return;
        await detect(target);
        return;
      }
      await processChunk(chunk, target);
    },
    async flush(target) {
      if (state === null) await detect(target);
    },
  });
}

async function isScrambled(url, signal) {
  let pending = plainFiles.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetchPartWithRetry(url, 0, 7, signal);
      if (!response.ok) return true;
      return !looksLikeMp4(new Uint8Array(await response.arrayBuffer()));
    })();
    setBounded(plainFiles, url, pending);
    pending.then(
      (value) => {
        if (plainFiles.get(url) === pending) pending.resolved = value;
      },
      () => {},
    );
  }
  try {
    return await pending;
  } catch (error) {
    if (plainFiles.get(url) === pending) plainFiles.delete(url);
    throw error;
  }
}

function cacheScrambledResult(url, value) {
  const pending = Promise.resolve(value);
  pending.resolved = value;
  setBounded(plainFiles, url, pending);
  return pending;
}

function wrapBody(body, controller, removeRequestAbort) {
  const reader = body.getReader();
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    removeRequestAbort();
  };
  return new ReadableStream({
    async pull(target) {
      try {
        const result = await reader.read();
        if (result.done) {
          cleanup();
          target.close();
        } else {
          target.enqueue(result.value);
        }
      } catch (error) {
        controller.abort();
        cleanup();
        target.error(error);
      }
    },
    async cancel(reason) {
      controller.abort();
      cleanup();
      await reader.cancel(reason);
    },
  });
}

async function serve(request, url) {
  const controller = new AbortController();
  let removeRequestAbort = () => {};
  if (request.signal) {
    if (request.signal.aborted) {
      controller.abort();
      return new Response(null, { status: 499 });
    }
    const onAbort = () => controller.abort();
    request.signal.addEventListener("abort", onAbort, { once: true });
    removeRequestAbort = () => request.signal.removeEventListener("abort", onAbort);
  }

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
  if (!valid) {
    removeRequestAbort();
    return new Response(null, { status: 400 });
  }

  const range = resolveRange(request.headers.get("range"), size);
  if (!range) {
    removeRequestAbort();
    const requested = RANGE_PATTERN.exec(request.headers.get("range") || "");
    const headers = requested && Number(requested[1]) >= size
      ? { "Content-Range": `bytes */${size}` }
      : undefined;
    return new Response(null, { status: 416, headers });
  }

  const { start, end } = range;
  const plan = planRequest(start, end, size, partSize);
  const sourceUrl = partUrl(media, plan.part);
  const keystreamPromise =
    plan.part === 0 && start < head ? keystreamFor(key, head) : null;
  let scrambled = null;
  let fetchPromise = fetchPartWithRetry(
    sourceUrl,
    plan.upstreamStart,
    plan.upstreamEnd,
    controller.signal,
  );
  try {
    if (plan.part === 0 && start > 0 && start < head) {
      const detectionPromise = isScrambled(media, controller.signal);
      [fetchPromise, scrambled] = await Promise.all([fetchPromise, detectionPromise]);
    } else if (plan.part === 0 && start === 0) {
      const cached = plainFiles.get(media);
      if (cached && Object.prototype.hasOwnProperty.call(cached, "resolved")) {
        scrambled = cached.resolved;
      }
    }
  } catch (error) {
    controller.abort();
    removeRequestAbort();
    throw error;
  }

  let response;
  try {
    response = await fetchPromise;
  } catch (error) {
    controller.abort();
    removeRequestAbort();
    throw error;
  }
  if (response.status !== 206 || !response.body) {
    await response.body?.cancel();
    removeRequestAbort();
    return new Response(null, { status: 502 });
  }

  let body = response.body;
  if (plan.part === 0 && start < head) {
    if (scrambled === null) {
      body = body.pipeThrough(
        createHeadTransform({
          start,
          head,
          keystreamPromise,
          scrambled: null,
          onDetected(value) {
            cacheScrambledResult(media, value);
          },
        }),
      );
    } else if (scrambled) {
      body = body.pipeThrough(
        createHeadTransform({ start, head, keystreamPromise, scrambled, onDetected: null }),
      );
    }
  }
  body = wrapBody(body, controller, removeRequestAbort);

  return new Response(body, {
    status: 206,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Range": `bytes ${start}-${plan.end}/${size}`,
      "Content-Length": String(plan.end - start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
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
self.__hdx = {
  planRequest,
  partUrl,
  unscramble,
  looksLikeMp4,
  resolveRange,
  createHeadTransform,
};
