type FilmSource = "avs" | "kk";

export interface User {
  id: number;
  username: string;
  display_name: string;
  created_at: number;
}

export interface FilmRef {
  id: string;
  source: FilmSource;
  title: string;
  poster: string;
  banner: string;
  genres: { slug: string; name: string }[];
}

export interface ProgressEntry {
  film: FilmRef;
  episode: { slug: string; name: string };
  position: number;
  duration: number;
  updated_at: number;
}

export class AccountError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;
  readonly retry_after?: number;

  constructor(status: number, code: string, field?: string, retry_after?: number) {
    super(code);
    this.name = "AccountError";
    this.status = status;
    this.code = code;
    this.field = field;
    this.retry_after = retry_after;
  }
}

const messages: Record<string, string> = {
  invalid_input: "Thông tin chưa hợp lệ.",
  invalid_credentials: "Tên đăng nhập hoặc mật khẩu không đúng.",
  unauthenticated: "Vui lòng đăng nhập để tiếp tục.",
  forbidden_origin: "Yêu cầu không được phép.",
  username_taken: "Tên đăng nhập đã được sử dụng.",
  too_large: "Dữ liệu gửi lên quá lớn.",
  rate_limited: "Bạn thao tác quá nhanh. Vui lòng thử lại sau.",
};

export function accountErrorMessage(error: unknown): string {
  if (error instanceof AccountError) {
    return messages[error.code] ?? "Có lỗi xảy ra. Vui lòng thử lại.";
  }
  return "Không thể kết nối. Vui lòng thử lại.";
}

interface ApiResponse {
  success?: boolean;
  code?: unknown;
  field?: unknown;
  retry_after?: unknown;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new AccountError(0, "network_error");
  }

  let payload: unknown = undefined;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  const body = (payload && typeof payload === "object" ? payload : {}) as ApiResponse;
  if (!response.ok || body.success === false) {
    const code = typeof body.code === "string" ? body.code : "request_failed";
    const field = typeof body.field === "string" ? body.field : undefined;
    const retryAfter = typeof body.retry_after === "number" ? body.retry_after : undefined;
    throw new AccountError(response.status, code, field, retryAfter);
  }

  return payload as T;
}

function body(value: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(value) };
}

export async function register(
  username: string,
  password: string,
  display_name?: string,
): Promise<User> {
  const result = await request<{ user: User }>(
    "/api/auth/register",
    body({ username, password, ...(display_name ? { display_name } : {}) }),
  );
  return result.user;
}

export async function login(username: string, password: string): Promise<User> {
  const result = await request<{ user: User }>("/api/auth/login", body({ username, password }));
  return result.user;
}

export async function logout(): Promise<void> {
  await request("/api/auth/logout", { method: "POST" });
}

export async function currentUser(signal?: AbortSignal): Promise<User> {
  const result = await request<{ user: User }>("/api/auth/me", { signal });
  return result.user;
}

export async function updateProfile(display_name: string): Promise<User> {
  const result = await request<{ user: User }>("/api/auth/profile", body({ display_name }));
  return result.user;
}

export async function changePassword(
  current_password: string,
  new_password: string,
): Promise<void> {
  await request("/api/auth/password", body({ current_password, new_password }));
}

export async function getFavorites(): Promise<{ film: FilmRef; saved_at: number }[]> {
  const result = await request<{ items: { film: FilmRef; saved_at: number }[] }>(
    "/api/me/favorites",
  );
  return result.items;
}

export async function saveFavorite(film: FilmRef): Promise<void> {
  await request("/api/me/favorites", {
    ...body({ film }),
    method: "PUT",
  });
}

export async function removeFavorite(id: string): Promise<void> {
  await request(`/api/me/favorites?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getProgress(id?: string): Promise<ProgressEntry[]> {
  const suffix = id === undefined ? "" : `?id=${encodeURIComponent(id)}`;
  const result = await request<{ items: ProgressEntry[] }>(`/api/me/progress${suffix}`);
  return result.items;
}

export async function saveProgress(
  film: FilmRef,
  episode: { slug: string; name: string },
  position: number,
  duration: number,
): Promise<void> {
  await request("/api/me/progress", {
    ...body({ film, episode, position, duration }),
    method: "PUT",
  });
}

export async function removeProgress(id: string): Promise<void> {
  await request(`/api/me/progress?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function toFilmRef(movie: IMovie): FilmRef {
  return {
    id: movie.slug,
    source: movie.source,
    title: movie.name,
    poster: movie.poster_url,
    banner: movie.thumb_url,
    genres: movie.category.map((genre) => ({ slug: genre.slug, name: genre.name })),
  };
}
