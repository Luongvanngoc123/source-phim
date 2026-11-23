/** The only place that builds internal URLs. */
export const paths = {
  home: "/",
  kkSeries: "/phim-bo",
  kkMovies: "/phim-le",
  kkAnimation: "/hoat-hinh",
  kkTvShows: "/tv-shows",
  category: (slug: string) => `/the-loai/${encodeURIComponent(slug)}`,
  country: (slug: string) => `/quoc-gia/${encodeURIComponent(slug)}`,
  animeSeries: "/anime-bo",
  animeMovies: "/anime-le",
  upcoming: "/sap-chieu",
  schedule: "/lich-chieu",
  topics: "/chu-de",
  topic: (slug: string) => `/chu-de/${encodeURIComponent(slug)}`,
  season: (seasonSlug: string) => `/mua/${encodeURIComponent(seasonSlug.replace("/", "-"))}`,
  genre: (source: FilmSource, slug: string) =>
    source === "kk"
      ? `/the-loai/${encodeURIComponent(slug)}`
      : `/chu-de/${encodeURIComponent(slug)}`,
  search: (query: string) => `/tim-kiem?q=${encodeURIComponent(query)}`,
  film: (id: string) => `/phim/${encodeURIComponent(id)}`,
  watch: (id: string, tapSlug: string) =>
    `/phim/${encodeURIComponent(id)}/${encodeURIComponent(tapSlug)}`,
  account: "/tai-khoan",
  saved: "/phim-da-luu",
  continueWatching: "/xem-tiep",
} as const;
