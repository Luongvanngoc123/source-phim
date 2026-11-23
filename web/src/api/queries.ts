import { useEffect, useState } from "react";
import {
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { ApiError, fetchJson } from "./client";
import type {
  AnimeDetail,
  CatalogResponse,
  GenresResponse,
  HomeResponse,
  SearchResponse,
  ScheduleResponse,
  SuggestResponse,
} from "./types";
import type { CatalogKind } from "../app/paths";

const FIVE_MINUTES = 5 * 60_000;
const ONE_MINUTE = 60_000;

/**
 * One retry, and only when the request never got an answer. An HTTP error from the engine is
 * not retried: it already spent its own timeout on the upstream (about 15s for a 502).
 */
function retryOnce(failureCount: number, error: ApiError): boolean {
  return failureCount < 1 && error.status === 0;
}

const queryKeys = {
  home: () => ["home"] as const,
  schedule: () => ["schedule"] as const,
  catalog: (kind: CatalogKind, page: number) =>
    ["catalog", kind, page] as const,
  genres: () => ["genres"] as const,
  genre: (slug: string, page: number) => ["genre", slug, page] as const,
  season: (slug: string, page: number) => ["season", slug, page] as const,
  suggest: (query: string) => ["suggest", query] as const,
  search: (query: string, page: number) => ["search", query, page] as const,
  anime: (slug: string | undefined) => ["anime", slug] as const,
};

const paginatedOptions = {
  placeholderData: keepPreviousData,
  retry: retryOnce,
  staleTime: FIVE_MINUTES,
} as const;

export function useHome(): UseQueryResult<HomeResponse, ApiError> {
  return useQuery({
    queryKey: queryKeys.home(),
    queryFn: ({ signal }) => fetchJson<HomeResponse>("/api/home", signal),
    staleTime: FIVE_MINUTES,
    retry: retryOnce,
  });
}

export function useSchedule(): UseQueryResult<ScheduleResponse, ApiError> {
  return useQuery({
    queryKey: queryKeys.schedule(),
    queryFn: ({ signal }) =>
      fetchJson<ScheduleResponse>("/api/schedule", signal),
    staleTime: ONE_MINUTE,
    retry: retryOnce,
  });
}

export function useCatalog(
  kind: CatalogKind,
  page: number,
): UseQueryResult<CatalogResponse, ApiError> {
  return useQuery({
    ...paginatedOptions,
    queryKey: queryKeys.catalog(kind, page),
    queryFn: ({ signal }) =>
      fetchJson<CatalogResponse>(`/api/${kind}?page=${page}`, signal),
  });
}

export function useGenres(): UseQueryResult<GenresResponse, ApiError> {
  return useQuery({
    queryKey: queryKeys.genres(),
    queryFn: ({ signal }) => fetchJson<GenresResponse>("/api/genres", signal),
    staleTime: FIVE_MINUTES,
    retry: retryOnce,
  });
}

export function useGenre(
  slug: string,
  page: number,
): UseQueryResult<CatalogResponse, ApiError> {
  const path = `/api/genre?slug=${encodeURIComponent(slug)}&page=${page}`;

  return useQuery({
    ...paginatedOptions,
    queryKey: queryKeys.genre(slug, page),
    queryFn: ({ signal }) => fetchJson<CatalogResponse>(path, signal),
  });
}

export function useSeason(
  seasonSlug: string,
  page: number,
): UseQueryResult<CatalogResponse, ApiError> {
  const path = `/api/catalog?path=season/${encodeURIComponent(seasonSlug)}&page=${page}`;

  return useQuery({
    ...paginatedOptions,
    queryKey: queryKeys.season(seasonSlug, page),
    queryFn: ({ signal }) => fetchJson<CatalogResponse>(path, signal),
  });
}

export function useSuggest(
  q: string,
): UseQueryResult<SuggestResponse, ApiError> {
  const [debounced, setDebounced] = useState(q);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q), 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  const normalized = debounced.trim();

  return useQuery({
    queryKey: queryKeys.suggest(normalized),
    queryFn: ({ signal }) =>
      fetchJson<SuggestResponse>(
        `/api/suggest?q=${encodeURIComponent(normalized)}`,
        signal,
      ),
    enabled: normalized.length >= 2,
    staleTime: ONE_MINUTE,
    retry: retryOnce,
  });
}

export function useSearch(
  q: string,
  page: number,
): UseQueryResult<SearchResponse, ApiError> {
  const normalized = q.trim();

  return useQuery({
    ...paginatedOptions,
    queryKey: queryKeys.search(normalized, page),
    queryFn: ({ signal }) =>
      fetchJson<SearchResponse>(
        `/api/search?q=${encodeURIComponent(normalized)}&page=${page}`,
        signal,
      ),
  });
}

export function useAnime(
  slug: string | undefined,
): UseQueryResult<AnimeDetail, ApiError> {
  return useQuery({
    queryKey: queryKeys.anime(slug),
    queryFn: ({ signal }) =>
      fetchJson<AnimeDetail>(
        `/api/anime?slug=${encodeURIComponent(slug ?? "")}`,
        signal,
      ),
    enabled: slug !== undefined,
    staleTime: FIVE_MINUTES,
    retry: retryOnce,
  });
}

export function playlistUrl(watchUrl: string): string {
  return `/api/playlist.m3u8?url=${encodeURIComponent(watchUrl)}`;
}
