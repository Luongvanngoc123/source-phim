import {
  getAnime,
  getCatalog,
  getGenre,
  getSearch,
  getSuggest,
  getSeason,
  streamInfoUrl,
} from "./engine";
import { detailToFilm, toMovie, toPagination } from "./adapter";
import {
  getCategory,
  getCountry,
  getDetail,
  getDirectories as getKkDirectories,
  getList,
  search as searchKk,
  stripKkPrefix,
} from "./kkphim";

export type CatalogSpec =
  | { source: "avs"; list: "series" | "movies" | "upcoming" }
  | { source: "avs"; genre: string }
  | { source: "avs"; season: string }
  | {
      source: "kk";
      list: "phim-moi" | "phim-bo" | "phim-le" | "hoat-hinh" | "tv-shows";
      category?: string;
      country?: string;
      year?: number;
      sort?: "modified" | "year";
      lang?: "vietsub" | "thuyet-minh" | "long-tieng";
    }
  | { source: "kk"; category: string }
  | { source: "kk"; country: string };

/**
 * The anime source lists a title's type ("Anime bộ", "Anime lẻ") among its genres. A type
 * says nothing about taste, so related films and recommendations leave it out.
 */
export const TYPE_CATEGORY_SLUGS: Record<string, true> = { "anime-bo": true, "anime-le": true };

export async function getFilm(id: string): Promise<IFilm> {
  if (id.startsWith("kk_")) return getDetail(stripKkPrefix(id));
  return detailToFilm(await getAnime(id));
}

export function findEpisode(
  film: IFilm,
  tapSlug: string,
): { server: IServer; episode: IEpisode; index: number } | undefined {
  for (const server of film.servers) {
    const index = server.episodes.findIndex((episode) => episode.slug === tapSlug);
    if (index >= 0) return { server, episode: server.episodes[index], index };
  }
  return undefined;
}

/** For anime this asks the engine which server to play; KKPhim hands over its playlist. */
export function streamUrl(episode: IEpisode): string {
  return episode.stream.kind === "engine" ? streamInfoUrl(episode.stream.url) : episode.stream.url;
}

export async function getRelated(film: IFilm, limit = 12): Promise<IMovie[]> {
  const candidates = film.movie.category;
  const excluded = film.movie.slug;
  const first = candidates.find(
    (category) => film.movie.source === "kk" || !TYPE_CATEGORY_SLUGS[category.slug],
  );
  if (!first) return [];
  if (film.movie.source === "kk") {
    const page = await getCategory(first.slug);
    return page.items.filter((item) => item.slug !== excluded).slice(0, limit);
  }
  const page = await getGenre(first.slug);
  return page.items
    .filter((item) => item.slug !== excluded)
    .slice(0, limit)
    .map(toMovie);
}

export async function getCatalogPage(
  spec: CatalogSpec,
  page = 1,
): Promise<{ items: IMovie[]; pagination: IPagination }> {
  if (spec.source === "kk") {
    if ("list" in spec) return getList(spec.list, page, spec);
    if ("category" in spec) return getCategory(spec.category, page);
    return getCountry(spec.country, page);
  }
  const response =
    "list" in spec
      ? await getCatalog(spec.list, page)
      : "genre" in spec
        ? await getGenre(spec.genre, page)
        : await getSeason(spec.season, page);
  return {
    items: response.items.map(toMovie),
    pagination: toPagination(response.page, response.count, response.total_pages),
  };
}

export async function searchFilms(
  source: FilmSource,
  query: string,
  page = 1,
): Promise<{ items: IMovie[]; pagination: IPagination }> {
  if (source === "kk") return searchKk(query, page);
  const response = await getSearch(query, page);
  return {
    items: response.items.map(toMovie),
    pagination: toPagination(response.page, response.count, response.total_pages),
  };
}

function suggestMovie(item: {
  title: string;
  slug: string;
  poster: string;
  episode_note: string | null;
}): IMovie {
  return {
    source: "avs",
    _id: item.slug,
    slug: item.slug,
    name: item.title,
    origin_name: item.episode_note ?? "",
    content: "",
    thumb_url: item.poster,
    poster_url: item.poster,
    backdrops: [],
    badges: [],
    episode_current: "",
    episode_total: "",
    quality: "",
    lang: [0],
    year: 0,
    rating: 0,
    category: [],
  };
}

export async function suggestFilms(query: string): Promise<IMovie[]> {
  const [animeResult, kkResult] = await Promise.allSettled([getSuggest(query), searchKk(query, 1)]);
  const anime = animeResult.status === "fulfilled" ? animeResult.value.items.map(suggestMovie) : [];
  const kk = kkResult.status === "fulfilled" ? kkResult.value.items.slice(0, 4) : [];
  const result: IMovie[] = [];
  const count = Math.max(anime.length, kk.length);
  for (let index = 0; index < count && result.length < 8; index += 1) {
    if (anime[index]) result.push(anime[index]);
    if (kk[index] && result.length < 8) result.push(kk[index]);
  }
  return result;
}

export function getDirectories(): Promise<{
  categories: { slug: string; name: string }[];
  countries: { slug: string; name: string }[];
}> {
  return getKkDirectories();
}
