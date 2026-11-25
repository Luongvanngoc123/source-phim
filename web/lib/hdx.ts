import { API_BASE } from "./engine";
import type { HdxSource } from "@/types/engine";

/** The worker that serves the backup server's files; see `public/hdx-sw.js`. */
const WORKER_URL = "/hdx-sw.js";
const CLAIM_TIMEOUT_MS = 3000;

let registration: Promise<boolean> | null = null;

/**
 * Put the media worker in charge of this page.
 *
 * Its files can only be read through the worker, so playback waits for it. A page that was
 * open before the worker installed is not controlled by it until it asks to be.
 */
export function ensureHdxWorker(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(false);
  }
  registration ??= (async () => {
    try {
      const worker = await navigator.serviceWorker.register(WORKER_URL, { scope: "/" });
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        const active = worker.active ?? navigator.serviceWorker.controller;
        active?.postMessage({ type: "claim" });
        const claimed = Promise.withResolvers<void>();
        const done = () => {
          navigator.serviceWorker.removeEventListener("controllerchange", done);
          claimed.resolve();
        };
        navigator.serviceWorker.addEventListener("controllerchange", done);
        setTimeout(done, CLAIM_TIMEOUT_MS);
        await claimed.promise;
      }
      return navigator.serviceWorker.controller !== null;
    } catch {
      return false;
    }
  })();
  return registration;
}

/** Whether a stream's files are read back through the engine rather than the worker. */
export function isProxyStream(sources: HdxSource[]): boolean {
  return sources.length > 0 && "proxy" in sources[0];
}

/** What the `<video>` element plays for one source. */
export function hdxMediaUrl(source: HdxSource): string {
  if ("proxy" in source) {
    return `${API_BASE}${source.proxy}`;
  }
  const query = new URLSearchParams({
    u: source.url,
    s: String(source.size),
    p: String(source.part_size),
    k: source.key,
    h: String(source.encrypted_head),
  });
  return `/hdx/media.mp4?${query.toString()}`;
}

/** Whether this browser can decode a source, so an AV1-only file is not chosen in vain. */
function canPlay(source: HdxSource): boolean {
  if (typeof document === "undefined") return true;
  const probe = document.createElement("video");
  const codec = source.codec === "av1" ? 'codecs="av01.0.05M.08"' : 'codecs="avc1.4d401f"';
  return probe.canPlayType(`video/mp4; ${codec}`) !== "";
}

/**
 * The file to start with: the best one the screen can show and the browser can decode, and
 * the smallest when the browser has been asked to save data.
 */
export function defaultSourceIndex(sources: HdxSource[]): number {
  if (sources.length === 0) return -1;
  const saveData =
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ===
      true;
  if (saveData) return sources.length - 1;
  const wide =
    typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches === true;
  const cap = wide ? 1080 : 720;
  // Sources arrive best-first, so the first that fits and plays is the highest such one.
  const best = sources.findIndex((source) => source.height <= cap && canPlay(source));
  if (best >= 0) return best;
  const playable = sources.findIndex(canPlay);
  return playable >= 0 ? playable : sources.length - 1;
}
