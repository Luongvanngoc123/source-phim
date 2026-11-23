export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message = "Không tải được dữ liệu.") {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function fetchJson<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      signal,
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiError(0);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(0);
  }

  if (!response.ok) {
    throw new ApiError(response.status);
  }

  return body as T;
}
