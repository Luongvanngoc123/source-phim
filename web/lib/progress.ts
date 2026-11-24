import { useCallback, useEffect, useRef, useState } from "react";
import { getProgress, saveProgress } from "@/lib/account";
import type { FilmRef, ProgressEntry } from "@/lib/account";
import { useAuth } from "@/context/AuthContext";

const STORAGE_KEY = "animora_progress";
const MAX_FILMS = 100;
const STORE_EVENT = "animora-progress-changed";

type StoredProgress = Record<string, ProgressEntry[]>;

function readStore(): StoredProgress {
  if (typeof window === "undefined") return {};
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as StoredProgress;
  } catch {
    return {};
  }
}

function writeStore(store: StoredProgress): void {
  if (typeof window === "undefined") return;
  try {
    const ids = Object.keys(store).sort((a, b) => {
      const aTime = Math.max(...(store[a] ?? []).map((entry) => entry.updated_at), 0);
      const bTime = Math.max(...(store[b] ?? []).map((entry) => entry.updated_at), 0);
      return bTime - aTime;
    });
    const limited: StoredProgress = {};
    for (const id of ids.slice(0, MAX_FILMS)) limited[id] = store[id];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(limited));
    window.dispatchEvent(new Event(STORE_EVENT));
  } catch {
    // Storage can be disabled or full; playback remains usable without persistence.
  }
}

function updateLocal(entry: ProgressEntry): void {
  const store = readStore();
  const entries = store[entry.film.id] ?? [];
  const index = entries.findIndex((item) => item.episode.slug === entry.episode.slug);
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);
  store[entry.film.id] = entries;
  writeStore(store);
}

export function getLocalProgress(): ProgressEntry[] {
  return Object.values(readStore())
    .flat()
    .sort((a, b) => b.updated_at - a.updated_at);
}
export function latestFilmProgress(entries: ProgressEntry[]): ProgressEntry[] {
  const latest = new Map<string, ProgressEntry>();
  for (const entry of entries) {
    const previous = latest.get(entry.film.id);
    if (!previous || entry.updated_at > previous.updated_at) latest.set(entry.film.id, entry);
  }
  return [...latest.values()].sort((a, b) => b.updated_at - a.updated_at);
}

export function clearLocalProgress(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(STORE_EVENT));
}

let syncedUserId: number | null = null;

export async function syncLocalProgress(userId: number): Promise<void> {
  if (syncedUserId === userId) return;
  const entries = getLocalProgress();
  if (entries.length === 0) {
    syncedUserId = userId;
    return;
  }
  try {
    for (const entry of entries) {
      await saveProgress(entry.film, entry.episode, entry.position, entry.duration);
    }
    clearLocalProgress();
    syncedUserId = userId;
  } catch {
    // Keep browser progress so a transient failure can be retried after the next sign-in.
  }
}

const LIVE_STORAGE_KEY = "animora_live_progress";

type LiveProgress = { owner: string; entry: ProgressEntry };

function readLive(): LiveProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(LIVE_STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as { owner?: unknown; entry?: unknown };
    if (typeof record.owner !== "string" || !record.entry || typeof record.entry !== "object") {
      return null;
    }
    const entry = record.entry as Partial<ProgressEntry>;
    if (!entry.film || !entry.episode) return null;
    return { owner: record.owner, entry: entry as ProgressEntry };
  } catch {
    return null;
  }
}

function writeLive(owner: string, entry: ProgressEntry): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify({ owner, entry }));
  } catch {
    // Storage can be disabled or full; playback remains usable without persistence.
  }
}

/**
 * Forget one film in this browser: its entries in the visitor store and, when it is the
 * film watched last, the exact position kept for a reload. Removing a film from the history
 * calls this, or opening the film again would still resume where it was left.
 */
export function removeLocalProgress(filmId: string): void {
  if (typeof window === "undefined") return;
  const store = readStore();
  if (filmId in store) {
    delete store[filmId];
    writeStore(store);
  }
  if (readLive()?.entry.film.id === filmId) {
    try {
      window.localStorage.removeItem(LIVE_STORAGE_KEY);
    } catch {
      // Storage can be disabled; there is then nothing kept to forget.
    }
  }
}

function resumePosition(entry: ProgressEntry | undefined): number | undefined {
  if (!entry || entry.position < 1) return undefined;
  if (entry.duration > 0 && entry.duration - entry.position < 5) return undefined;
  return entry.position;
}

export function useWatchProgress(
  film: FilmRef | undefined,
  episode: { slug: string; name: string } | undefined,
): {
  ready: boolean;
  startAt: number | undefined;
  report(position: number, duration: number, urgent?: boolean): void;
} {
  const { user, loading: authLoading } = useAuth();
  // The saved position belongs to one account (or the browser), film and episode. Readiness
  // is derived from that key, so a render with new inputs never reports the previous
  // episode as ready and the player is built exactly once.
  const key =
    authLoading || !film || !episode ? null : `${user?.id ?? "local"}:${film.id}:${episode.slug}`;
  const [loaded, setLoaded] = useState<{ key: string; startAt: number | undefined } | null>(null);
  const pendingRef = useRef<ProgressEntry | undefined>(undefined);
  const lastWriteRef = useRef(0);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRef = useRef({ film, episode, user });
  currentRef.current = { film, episode, user };

  useEffect(() => {
    if (key === null || !film || !episode) return undefined;
    let active = true;
    const owner = user ? String(user.id) : "local";
    const load = async () => {
      let stored: ProgressEntry | undefined;
      try {
        const entries = user ? await getProgress(film.id) : (readStore()[film.id] ?? []);
        stored = entries.find((item) => item.episode.slug === episode.slug);
      } catch {
        stored = undefined;
      }
      const live = readLive();
      const liveEntry =
        live &&
        live.owner === owner &&
        live.entry.film.id === film.id &&
        live.entry.episode.slug === episode.slug
          ? live.entry
          : undefined;
      const chosen =
        liveEntry && (!stored || liveEntry.updated_at + 60 >= stored.updated_at)
          ? liveEntry
          : stored;
      if (active) setLoaded({ key, startAt: resumePosition(chosen) });
    };
    void load();
    return () => {
      active = false;
    };
  }, [key]);

  const flush = useCallback(async (keepalive = false) => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = undefined;
    lastWriteRef.current = Date.now();
    if (currentRef.current.user) {
      try {
        await saveProgress(
          pending.film,
          pending.episode,
          pending.position,
          pending.duration,
          keepalive,
        );
      } catch {
        if (!pendingRef.current) pendingRef.current = pending;
      }
    } else {
      updateLocal(pending);
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (writeTimerRef.current) return;
    const wait = Math.max(0, 10000 - (Date.now() - lastWriteRef.current));
    writeTimerRef.current = setTimeout(() => {
      writeTimerRef.current = null;
      void flush();
    }, wait);
  }, [flush]);

  const report = useCallback(
    (position: number, duration: number, urgent = false) => {
      const current = currentRef.current;
      if (!current.film || !current.episode || !Number.isFinite(position)) return;
      const entry: ProgressEntry = {
        film: current.film,
        episode: current.episode,
        position: Math.max(0, position),
        duration: Number.isFinite(duration) ? duration : 0,
        updated_at: Math.floor(Date.now() / 1000),
      };
      writeLive(current.user ? String(current.user.id) : "local", entry);
      pendingRef.current = entry;
      if (urgent) {
        if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
        void flush(true);
      } else {
        scheduleFlush();
      }
    },
    [flush, scheduleFlush],
  );

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
        void flush(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
      void flush(true);
    };
  }, [flush]);

  const ready = key !== null && loaded?.key === key;
  return { ready, startAt: ready ? loaded.startAt : undefined, report };
}
