import { seasonRouteSlug } from "./adapter";

/** The only place that builds internal URLs. */
export const paths = {
  home: "/",
  series: "/phim-bo",
  movies: "/phim-le",
  upcoming: "/sap-chieu",
  schedule: "/lich-chieu",
  genres: "/chu-de",
  genre: (slug: string) => `/the-loai/${encodeURIComponent(slug)}`,
  /** `seasonSlug` is the engine's slug, e.g. "winter/2026". */
  season: (seasonSlug: string) => `/mua/${encodeURIComponent(seasonRouteSlug(seasonSlug))}`,
  search: (query: string) => `/tim-kiem?q=${encodeURIComponent(query)}`,
  film: (slug: string) => `/phim/${encodeURIComponent(slug)}`,
  watch: (slug: string, tapSlug: string) =>
    `/phim/${encodeURIComponent(slug)}/${encodeURIComponent(tapSlug)}`,
} as const;
