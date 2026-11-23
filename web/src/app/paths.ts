export type CatalogKind = "series" | "movies" | "upcoming";

const catalogPaths: Record<CatalogKind, string> = {
  series: "/anime-bo",
  movies: "/anime-le",
  upcoming: "/sap-chieu",
};

function pageQuery(page: number): string {
  return page > 1 ? `?trang=${page}` : "";
}

export const paths = {
  home: () => "/",
  schedule: () => "/lich-chieu",
  catalog: (kind: CatalogKind, page = 1) =>
    `${catalogPaths[kind]}${pageQuery(page)}`,
  genres: () => "/the-loai",
  genre: (slug: string, page = 1) =>
    `/the-loai/${encodeURIComponent(slug)}${pageQuery(page)}`,
  season: (seasonSlug: string, page = 1) => {
    const [season = "", year = ""] = seasonSlug.split("/");
    const seasonPath = `/mua/${encodeURIComponent(season)}/${encodeURIComponent(year)}`;
    return `${seasonPath}${pageQuery(page)}`;
  },
  search: (query: string, page = 1) =>
    `/tim-kiem?q=${encodeURIComponent(query)}${page > 1 ? `&trang=${page}` : ""}`,
  anime: (slug: string) => `/phim/${encodeURIComponent(slug)}`,
  watch: (slug: string, episodeId: string) =>
    `/phim/${encodeURIComponent(slug)}/tap/${encodeURIComponent(episodeId)}`,
};
