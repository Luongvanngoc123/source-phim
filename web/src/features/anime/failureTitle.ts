import { ApiError } from "../../api/client";

/** Whether the engine answered that the title does not exist. */
export function isMissingTitle(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** The page heading when a title could not be loaded. */
export function failureTitle(error: unknown): string {
  return isMissingTitle(error)
    ? "Không tìm thấy phim này"
    : "Không tải được phim";
}
