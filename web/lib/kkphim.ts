import { getCachedJson, EngineError } from "./engine";
import { paths } from "./paths";

const BASE_URL = process.env.NEXT_PUBLIC_KK_API ?? "https://phimapi.com";
const ITEMS_PER_PAGE = 24;

/** Upstream status codes, shown to readers in Vietnamese. Unknown codes are left out. */
const STATUS_LABELS: Record<string, string | undefined> = {
  ongoing: "Đang chiếu",
  completed: "Hoàn tất",
  trailer: "Sắp chiếu",
};

interface KkCategory {
  id?: string;
  name: string;
  slug: string;
}

interface KkMovie {
  _id?: string;
  slug: string;
  name: string;
  origin_name?: string;
  content?: string;
  type?: string;
  thumb_url?: string;
  poster_url?: string;
  time?: string;
  episode_current?: string;
  episode_total?: number;
  quality?: string;
  lang?: string;
  year?: number;
  status?: string;
  view?: number;
  actor?: string[];
  director?: string[];
  category?: KkCategory[];
  country?: KkCategory[];
  tmdb?: { vote_average?: number; vote_count?: number };
}

interface KkEpisode {
  server_name?: string;
  server_data?: Array<{ name?: string; slug?: string; link_m3u8?: string }>;
}

interface KkDetailResponse {
  status?: boolean | string;
  movie?: KkMovie;
  episodes?: KkEpisode[];
}

interface KkListResponse {
  status?: boolean | string;
  pathImage?: string;
  items?: KkMovie[];
  pagination?: KkPagination;
  data?: {
    items?: KkMovie[];
    APP_DOMAIN_CDN_IMAGE?: string;
    params?: { pagination?: KkPagination };
  };
}

interface KkPagination {
  totalItems?: number;
  totalItemsPerPage?: number;
  currentPage?: number;
  totalPages?: number;
  pageRanges?: number;
}

interface KkDirectoryResponse {
  status?: boolean | string;
  data?: { items?: KkCategory[] };
}

export interface KkListOptions {
  category?: string;
  country?: string;
  year?: number;
  sort?: "modified" | "year";
  lang?: "vietsub" | "thuyet-minh" | "long-tieng";
}

function apiUrl(path: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function isSuccess(value: boolean | string | undefined): boolean {
  return value === true || value === "success" || value === undefined;
}

function requireSuccess(value: boolean | string | undefined): void {
  if (!isSuccess(value)) throw new EngineError(502);
}

function absoluteImage(value: string | undefined, pathImage?: string): string {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const base =
    pathImage ||
    (/^uploads?\//.test(value) ? "https://phimimg.com" : "https://phimimg.com/uploads/movies/");
  return `${base.replace(/\/$/, "")}/${value.replace(/^\/+/, "")}`;
}

function stripHtml(value: string | undefined): string {
  return (value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n +/g, "\n")
    .trim();
}

function languageCodes(value: string | undefined): number[] {
  const text = (value ?? "").toLocaleLowerCase();
  const result: number[] = [];
  if (text.includes("vietsub") || text.includes("phụ đề") || text.includes("phu de"))
    result.push(0);
  if (text.includes("thuyết minh") || text.includes("thuyet minh")) result.push(1);
  if (text.includes("lồng tiếng") || text.includes("long tieng")) result.push(2);
  return result;
}

function categories(value: KkCategory[] | undefined): ICategory[] {
  return (value ?? []).map((category) => ({
    slug: category.slug,
    name: category.name,
    href: paths.category(category.slug),
  }));
}

function toMovie(movie: KkMovie, pathImage?: string): IMovie {
  const poster = absoluteImage(movie.poster_url, pathImage);
  const thumb = absoluteImage(movie.thumb_url || movie.poster_url, pathImage);
  return {
    source: "kk",
    _id: `kk_${movie.slug}`,
    slug: `kk_${movie.slug}`,
    name: movie.name,
    origin_name: movie.origin_name ?? "",
    content: stripHtml(movie.content),
    thumb_url: thumb,
    poster_url: poster,
    backdrops: [],
    badges: [],
    episode_current: movie.episode_current ?? "",
    episode_total: movie.episode_total ? String(movie.episode_total) : "",
    quality: movie.quality ?? "",
    lang: languageCodes(movie.lang),
    year: movie.year ?? 0,
    rating: movie.tmdb?.vote_average ?? 0,
    category: categories(movie.category),
  };
}

function toPagination(
  page: number,
  pagination: KkPagination | undefined,
  count: number,
): IPagination {
  const currentPage = pagination?.currentPage ?? page;
  const totalItems = pagination?.totalItems ?? (currentPage - 1) * ITEMS_PER_PAGE + count;
  const itemsPerPage = pagination?.totalItemsPerPage ?? ITEMS_PER_PAGE;
  const totalPages = pagination?.totalPages ?? Math.max(1, Math.ceil(totalItems / itemsPerPage));
  return {
    totalItems,
    totalPages,
    currentPage,
    itemsPerPage,
    hasNext: currentPage < totalPages,
  };
}

function readList(
  response: KkListResponse,
  page: number,
): { items: KkMovie[]; pagination?: KkPagination; pathImage?: string } {
  requireSuccess(response.status);
  const data = response.data;
  return {
    items: response.items ?? data?.items ?? [],
    pagination: response.pagination ?? data?.params?.pagination,
    pathImage: response.pathImage ?? data?.APP_DOMAIN_CDN_IMAGE,
  };
}

function listPath(list: "phim-moi" | "phim-bo" | "phim-le" | "hoat-hinh" | "tv-shows"): string {
  return list === "phim-moi" ? "/danh-sach/phim-moi-cap-nhat-v3" : `/v1/api/danh-sach/${list}`;
}

function optionsParams(options?: KkListOptions): Record<string, string | number | undefined> {
  return {
    category: options?.category,
    country: options?.country,
    year: options?.year,
    sort_field: options?.sort === "year" ? "year" : options?.sort ? "modified.time" : undefined,
    sort_type: options?.sort === "year" ? "desc" : undefined,
    sort_lang: options?.lang,
  };
}

export async function getList(
  list: "phim-moi" | "phim-bo" | "phim-le" | "hoat-hinh" | "tv-shows",
  page = 1,
  options?: KkListOptions,
): Promise<{ items: IMovie[]; pagination: IPagination }> {
  const response = await getCachedJson<KkListResponse>(
    apiUrl(listPath(list), { page, ...optionsParams(options) }),
  );
  const parsed = readList(response, page);
  return {
    items: parsed.items.map((movie) => toMovie(movie, parsed.pathImage)),
    pagination: toPagination(page, parsed.pagination, parsed.items.length),
  };
}

export async function getCategory(
  slug: string,
  page = 1,
): Promise<{ items: IMovie[]; pagination: IPagination }> {
  const response = await getCachedJson<KkListResponse>(
    apiUrl(`/v1/api/the-loai/${encodeURIComponent(slug)}`, { page }),
  );
  const parsed = readList(response, page);
  return {
    items: parsed.items.map((movie) => toMovie(movie, parsed.pathImage)),
    pagination: toPagination(page, parsed.pagination, parsed.items.length),
  };
}

export async function getCountry(
  slug: string,
  page = 1,
): Promise<{ items: IMovie[]; pagination: IPagination }> {
  const response = await getCachedJson<KkListResponse>(
    apiUrl(`/v1/api/quoc-gia/${encodeURIComponent(slug)}`, { page }),
  );
  const parsed = readList(response, page);
  return {
    items: parsed.items.map((movie) => toMovie(movie, parsed.pathImage)),
    pagination: toPagination(page, parsed.pagination, parsed.items.length),
  };
}

export async function search(
  query: string,
  page = 1,
): Promise<{ items: IMovie[]; pagination: IPagination }> {
  const response = await getCachedJson<KkListResponse>(
    apiUrl("/v1/api/tim-kiem", { keyword: query, page, limit: ITEMS_PER_PAGE }),
  );
  const parsed = readList(response, page);
  return {
    items: parsed.items.map((movie) => toMovie(movie, parsed.pathImage)),
    pagination: toPagination(page, parsed.pagination, parsed.items.length),
  };
}

export async function getDirectories(): Promise<{
  categories: { slug: string; name: string }[];
  countries: { slug: string; name: string }[];
}> {
  const categoryResponse = await getCachedJson<KkDirectoryResponse>(apiUrl("/the-loai"));
  const countryResponse = await getCachedJson<KkDirectoryResponse>(apiUrl("/quoc-gia"));
  requireSuccess(categoryResponse.status);
  requireSuccess(countryResponse.status);
  return {
    categories: (categoryResponse.data?.items ?? []).map(({ slug, name }) => ({ slug, name })),
    countries: (countryResponse.data?.items ?? []).map(({ slug, name }) => ({ slug, name })),
  };
}

export async function getDetail(slug: string): Promise<IFilm> {
  const response = await getCachedJson<KkDetailResponse>(
    apiUrl(`/phim/${encodeURIComponent(slug)}`),
  );
  requireSuccess(response.status);
  if (!response.movie) throw new EngineError(502);
  const movie = response.movie;
  const servers: IServer[] = (response.episodes ?? [])
    .map((server, serverIndex) => ({
      name: server.server_name ?? `Server ${serverIndex + 1}`,
      episodes: (server.server_data ?? [])
        .filter((episode) => episode.slug && episode.link_m3u8)
        .map((episode) => ({
          _id: `${serverIndex}-${episode.slug}`,
          name: episode.name ?? episode.slug ?? "Tập",
          slug: `sv${serverIndex}-${episode.slug}`,
          stream: { kind: "direct" as const, url: episode.link_m3u8 ?? "" },
        })),
    }))
    .filter((server) => server.episodes.length > 0);
  const facts: IFilm["facts"] = [];
  for (const country of movie.country ?? []) {
    facts.push({ label: "Quốc gia", value: country.name, href: paths.country(country.slug) });
  }
  if (movie.director?.length) facts.push({ label: "Đạo diễn", value: movie.director.join(", ") });
  if (movie.actor?.length) facts.push({ label: "Diễn viên", value: movie.actor.join(", ") });
  if (movie.year) facts.push({ label: "Năm", value: String(movie.year) });
  const stats = [STATUS_LABELS[movie.status ?? ""], movie.time].filter((value): value is string =>
    Boolean(value?.trim()),
  );
  return {
    movie: toMovie(movie),
    // The upstream type separates live action from animation and TV shows, not films from
    // series, so the episode count decides how the film page presents itself.
    kind: servers.some((server) => server.episodes.length > 1) ? "series" : "movie",
    stats,
    facts,
    schedule: "",
    servers,
    parts: [],
  };
}

export function stripKkPrefix(id: string): string {
  return id.startsWith("kk_") ? id.slice(3) : id;
}
