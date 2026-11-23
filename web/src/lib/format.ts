import type { AnimeDetail, AnimeListItem } from "../api/types";

export function episodeLabel(raw: string): string {
  const value = raw.trim();
  const endMatch = value.match(/^(\d+)_END$/i);
  if (endMatch) {
    return `${String(Number(endMatch[1]))} (cuối)`;
  }
  if (/^\d+$/.test(value)) {
    return String(Number(value));
  }
  return value;
}

export function episodeTitle(raw: string): string {
  const value = raw.trim().replace(/^tập\s*/i, "");
  if (value.toLowerCase() === "full") {
    return "Bản đầy đủ";
  }
  return `Tập ${episodeLabel(value)}`;
}

/** The play action's label for an episode: "Xem tập 9", "Xem bản đầy đủ". */
export function playLabel(raw: string): string {
  const title = episodeTitle(raw);
  return `Xem ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
}

export function parseProgress(progress: string | null): {
  aired: number | null;
  total: number | null;
} {
  if (!progress) {
    return { aired: null, total: null };
  }

  const [airedPart, totalPart] = progress.split("/", 2);
  const aired = parseProgressNumber(airedPart);
  const total = parseProgressNumber(totalPart);
  return { aired, total };
}

function parseProgressNumber(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? "";
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

function badgeCaption(badge: string): string | null {
  const value = badge.trim().replace(/^tập\s*/i, "");
  if (!value) {
    return null;
  }
  if (value.toLowerCase() === "full") {
    return "Bản đầy đủ";
  }
  if (/^\d+(?:[-.]\d+|_END)?$/i.test(value)) {
    return episodeTitle(value);
  }
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function cardCaption(item: AnimeListItem): string | null {
  const progress = item.progress?.trim() ?? "";
  const isUpcoming =
    Boolean(item.schedule_badge?.trim()) ||
    progress.toUpperCase().startsWith("PV");

  if (isUpcoming) {
    const year = item.air_time?.trim() ?? "";
    return /^\d{4}$/.test(year) ? `Sắp chiếu ${year}` : "Sắp chiếu";
  }

  const parsed = parseProgress(progress || null);
  if (
    parsed.aired !== null &&
    parsed.total !== null &&
    parsed.aired === parsed.total
  ) {
    return `Trọn bộ ${parsed.total} tập`;
  }
  if (item.episode_badge?.trim()) {
    return badgeCaption(item.episode_badge);
  }
  if (parsed.aired !== null) {
    return `Tập ${parsed.aired}`;
  }
  return null;
}

export function subtitleCues(
  text: string,
  maxCues = 2,
  maxChars = 80,
): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || maxCues <= 0 || maxChars <= 0) {
    return [];
  }

  const cues: string[] = [];
  let remaining = clean;
  while (remaining && cues.length < maxCues) {
    if (remaining.length <= maxChars) {
      cues.push(remaining);
      break;
    }

    const candidate = remaining.slice(0, maxChars + 1);
    const lastSpace = candidate.lastIndexOf(" ");
    const wordBreak = lastSpace > 0 ? lastSpace : maxChars;
    const cutAt = findBoundary(candidate, maxChars) ?? wordBreak;
    cues.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  return cues;
}

function findBoundary(text: string, maxChars: number): number | null {
  const boundaryPattern = /[.!?;,:](?:\s|$)/g;
  let lastBoundary: number | null = null;
  let match = boundaryPattern.exec(text);
  while (match) {
    const boundary = match.index + 1;
    if (boundary >= Math.floor(maxChars * 0.45)) {
      lastBoundary = boundary;
    }
    match = boundaryPattern.exec(text);
  }
  return lastBoundary;
}

export function countText(text: string | null): string | null {
  if (!text) {
    return null;
  }
  const match = text.match(/\d[\d,]*/);
  if (!match) {
    return null;
  }
  const digits = match[0].replace(/,/g, "").replace(/^0+(?=\d)/, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function viewCount(text: string | null): string | null {
  if (!text || !/^\s*lượt xem\s*:/i.test(text)) {
    return null;
  }
  const digits = text.replace(/[^\d]/g, "");
  return digits ? `${Number(digits).toLocaleString("vi-VN")} lượt xem` : null;
}

export function vnWeekday(date: string): string {
  const parts = date.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    return "";
  }
  const weekday = new Date(
    Date.UTC(parts[0], parts[1] - 1, parts[2]),
  ).getUTCDay();
  return (
    [
      "Chủ Nhật",
      "Thứ Hai",
      "Thứ Ba",
      "Thứ Tư",
      "Thứ Năm",
      "Thứ Sáu",
      "Thứ Bảy",
    ][weekday] ?? ""
  );
}

export function vnDayMonth(date: string): string {
  const [, month, day] = date.split("-");
  return month && day ? `${day}/${month}` : "";
}

export function clockOf(airAt: string): string {
  return airAt.slice(11, 16);
}

export function countdownText(seconds: number, precise: boolean): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "đã lên sóng";
  }

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = Math.floor(seconds % 60);

  if (precise) {
    const clock = [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
      String(secs).padStart(2, "0"),
    ].join(":");
    return days > 0 ? `còn ${days} ngày ${clock}` : `còn ${clock}`;
  }
  if (days > 0) {
    return `còn ${days} ngày`;
  }
  if (hours > 0) {
    return `còn ${hours} giờ`;
  }
  return `còn ${minutes} phút`;
}

export function statusLine(
  detail: Pick<AnimeDetail, "episodes" | "duration">,
): string {
  const newest = detail.episodes.at(-1);
  if (!newest) {
    return "Sắp chiếu, chưa có tập nào.";
  }

  const { aired, total } = parseProgress(detail.duration);
  if (aired !== null && total !== null && aired === total) {
    return `Trọn bộ ${detail.episodes.length} tập.`;
  }
  return `${episodeTitle(newest.episode)} đã có vietsub.`;
}
