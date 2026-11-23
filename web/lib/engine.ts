import type {
  AnimeDetail,
  CatalogResponse,
  GenresResponse,
  HomeResponse,
  ScheduleResponse,
  SearchResponse,
  SuggestResponse,
} from "@/types/engine";

/** Origin of the engine. Empty in production: the engine serves this app, so calls are same-origin. */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

/** How long a successful JSON response is reused; the engine itself caches for five minutes. */
const CACHE_TTL_MS = 60_000;

export type CatalogKind = "series" | "movies" | "upcoming";

/** A failed engine call. `status` is the HTTP status, or 0 when the request never got an answer. */
export class EngineError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Engine request failed (${status})`);
    this.name = "EngineError";
    this.status = status;
  }
}

const cache = new Map<string, { expires: number; value: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();

async function request<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new EngineError(0);
  }
  if (!response.ok) {
    throw new EngineError(response.status);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new EngineError(response.status);
  }
}

/** One GET per URL at a time; successful answers are reused for `CACHE_TTL_MS`. */
function get<T>(path: string): Promise<T> {
  return getCachedJson(`${API_BASE}${path}`);
}

/** Shared cached GET for absolute third-party JSON URLs such as the KKPhim API. */
export function getCachedJson<T>(url: string): Promise<T> {
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) {
    return Promise.resolve(cached.value as T);
  }
  const pending = inFlight.get(url);
  if (pending) {
    return pending as Promise<T>;
  }
  const started = request<T>(url)
    .then((value) => {
      cache.set(url, { expires: Date.now() + CACHE_TTL_MS, value });
      return value;
    })
    .finally(() => {
      inFlight.delete(url);
    });
  inFlight.set(url, started);
  return started;
}

export function getHome(): Promise<HomeResponse> {
  return get("/api/home");
}

export function getSchedule(): Promise<ScheduleResponse> {
  return get("/api/schedule");
}

export function getCatalog(kind: CatalogKind, page = 1): Promise<CatalogResponse> {
  return get(`/api/${kind}?page=${page}`);
}

export function getGenres(): Promise<GenresResponse> {
  return get("/api/genres");
}

export function getGenre(slug: string, page = 1): Promise<CatalogResponse> {
  return get(`/api/genre?slug=${encodeURIComponent(slug)}&page=${page}`);
}

/** `seasonSlug` is the engine's slug, e.g. "winter/2026". */
export function getSeason(seasonSlug: string, page = 1): Promise<CatalogResponse> {
  return get(`/api/catalog?path=${encodeURIComponent(`season/${seasonSlug}`)}&page=${page}`);
}

export function getSearch(query: string, page = 1): Promise<SearchResponse> {
  return get(`/api/search?q=${encodeURIComponent(query)}&page=${page}`);
}

export function getAnime(slug: string): Promise<AnimeDetail> {
  return get(`/api/anime?slug=${encodeURIComponent(slug)}`);
}

/** HLS playlist URL for hls.js; `watchUrl` is an episode's `watch_url`. */
export function playlistUrl(watchUrl: string): string {
  return `${API_BASE}/api/playlist.m3u8?url=${encodeURIComponent(watchUrl)}`;
}

/** Vietnamese message for a failed load, chosen by status only. */
export function errorMessage(error: EngineError): string {
  if (error.status === 0) {
    return "Không kết nối được tới máy chủ. Kiểm tra mạng rồi thử lại.";
  }
  if (error.status === 404) {
    return "Không tìm thấy nội dung này.";
  }
  if (error.status === 400) {
    return "Yêu cầu không hợp lệ.";
  }
  return "Máy chủ đang bận. Thử lại sau ít phút.";
}

export function getSuggest(query: string): Promise<SuggestResponse> {
  return get(`/api/suggest?q=${encodeURIComponent(query)}`);
}
