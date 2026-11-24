export interface Genre {
  name: string;
  slug: string;
}

/** One title in any list: home blocks, catalogs, genre, season, search. */
export interface AnimeListItem {
  title: string;
  /** Stable id, e.g. "black-clover-2nd-season-a6073". */
  slug: string;
  film_id: string | null;
  /** Upstream page. Never link users to it. */
  url: string;
  /** Absolute image URL on cdn1 (283x400 JPEG typical); "" when the title has none. */
  poster: string;
  /** "TẬP 09" — newest episode, upper-cased upstream. null for movies/upcoming. */
  episode_badge: string | null;
  /** "SẮP CHIẾU", or countdown text like "13h 12m 1s". null for released titles. */
  schedule_badge: string | null;
  countdown_seconds: number | null;
  /** Upcoming titles: expected year/date text such as "2027". */
  air_time: string | null;
  /** "9.7" */
  rating: string | null;
  /** "FHD" | "HD" */
  quality: string | null;
  /** "09/??", "07/12", "03/03", "659/??", "PV/??" (PV = only a trailer exists). */
  progress: string | null;
  /** "2026" */
  year: string | null;
  /** Catalogs: "Lượt xem: 1,491,367". Schedule: comma-separated alternative titles. */
  views_or_subtitle: string | null;
  /** Teaser cut by the upstream, ends with "...". */
  description: string | null;
  studio: string | null;
  /** May be empty; always empty in schedule items. */
  genres: Genre[];
  detail_api: string;
}

/** A featured title: a list item plus wide key art for the home hero. */
export interface FeaturedItem extends AnimeListItem {
  /** (new) Wide key art (~720px, mostly 16:9). "" until the engine has seen this title's detail page. */
  banner?: string;
}

export interface HomeResponse {
  success: true;
  latest: AnimeListItem[];
  upcoming: AnimeListItem[];
  featured: FeaturedItem[];
}

export interface CatalogResponse {
  success: true;
  path: string;
  page: number;
  count: number;
  /** (new) Last page number, or null when the upstream page does not show one. */
  total_pages?: number | null;
  items: AnimeListItem[];
}

export interface SearchResponse {
  success: true;
  query: string;
  page: number;
  count: number;
  /** (new) Same meaning as in CatalogResponse. */
  total_pages?: number | null;
  items: AnimeListItem[];
}

/** Schedule items are list items plus airing time. The time fields are absent when the upstream text could not be parsed. */
export interface ScheduleItem extends AnimeListItem {
  /** "2026-11-25" */
  air_date?: string;
  /** "2026-11-25T21:00:00+07:00" — always Vietnam time. */
  air_at?: string;
  air_at_unix?: number;
}

export interface ScheduleDay {
  /** Upstream label with odd spacing, e.g. "Thứ Tư , Ngày 25 tháng 11". Format from `date` instead. */
  day: string;
  /** "2026-11-25" */
  date: string | null;
  count: number;
  /** Often empty. */
  items: ScheduleItem[];
}

export interface ScheduleResponse {
  success: true;
  generated_at_unix: number;
  /** Server clock at response time; use it to correct a skewed client clock. */
  server_time_unix?: number;
  day_count: number;
  schedule: ScheduleDay[];
}

export interface GenreRef extends Genre {
  api_url: string;
}

export interface SeasonRef {
  /** "Mùa Đông 2026" */
  name: string;
  /** "winter/2026" | "spring/2026" | "summer/2026" | "autumn/2026" … back to 2018. */
  slug: string;
  api_url: string;
}

export interface GenresResponse {
  success: true;
  genres: GenreRef[];
  seasons: SeasonRef[];
}

export interface SuggestItem {
  title: string;
  slug: string;
  poster: string;
  /** Alternative titles, e.g. "Black Clover Season 2". */
  episode_note: string | null;
  url: string;
  detail_api: string;
}

export interface SuggestResponse {
  success: true;
  query: string;
  count: number;
  items: SuggestItem[];
}

export interface Episode {
  /** Opaque label: "01", "12", "624-625", "1265_END", "Full", "12.5"… Not always a number. */
  episode: string;
  /** "Tập 01" */
  title: string;
  episode_id: string;
  source: string;
  /** Pass to /api/stream?url=. Never navigate users to it. */
  watch_url: string;
}

/** One video file of the backup server, to be read through the media worker. */
export interface HdxSource {
  /** "1080p" */
  label: string;
  height: number;
  codec: string;
  /** Bytes of the whole film. */
  size: number;
  /** Bytes per part; the parts after the first carry their number at the end of `url`. */
  part_size: number;
  url: string;
  /** 32 hexadecimal characters, the key of the scrambled head. */
  key: string;
  /** Bytes at the start of the first part that are scrambled. */
  encrypted_head: number;
}

/** What /api/stream says to play for one episode. */
export type EngineStream =
  | { success: true; type: "hls"; server: string; url: string }
  | { success: true; type: "mp4"; server: string; sources: HdxSource[] };

/** A related part of the same franchise (season 1, season 2, movie, special). */
export interface SeasonPart {
  /** "Phần 2", "Phần Movie", "Phần Special", "Phần TV Series" */
  name: string;
  title: string | null;
  slug: string;
  type: "series" | "movie" | "special";
  /** true for the part this detail belongs to. */
  active: boolean;
  url: string;
  detail_api: string;
}

export interface AnimeDetail {
  success: true;
  slug: string;
  film_id: string | null;
  type: "series" | "movie";
  title: string;
  /** Alternative titles. */
  sub_title: string | null;
  /** "" when missing. */
  poster: string;
  /** Wide key art, ~720px wide, mostly 16:9 (some 1.4:1 to 2.2:1), source watermark bottom-right. "" when missing. */
  banner: string;
  /** Full synopsis, plain text. May be "". */
  description: string;
  rating: string | null;
  /** "616" */
  rating_count: string | null;
  /** "2,170,789 Lượt Xem" */
  views: string | null;
  /** "Thứ Bảy vào lúc 23 giờ 00 phút hàng tuần" */
  schedule: string | null;
  /** "Phim đang chiếu/Cập Nhật Tập 09 VietSub" */
  status: string | null;
  /** "09/??" */
  duration: string | null;
  quality: string | null;
  /** "PG-13 - Teens 13 tuổi trở lên" */
  age_rating: string | null;
  /** "VietSub" */
  language: string | null;
  studio: string | null;
  director: string | null;
  country: string | null;
  /** "Mùa Thu - 2026" */
  season_release: string | null;
  /** "6,733" */
  followers: string | null;
  /** First entry is often the format ("Anime bộ", slug "anime-bo") rather than a genre. */
  genres: Genre[];
  /** Empty when the title has no related parts. */
  seasons: SeasonPart[];
  episode_count: number;
  /** Oldest first. Empty for unreleased titles. Can exceed 1200 entries. */
  episodes: Episode[];
}

export interface ApiErrorBody {
  success: false;
  error: string;
}
