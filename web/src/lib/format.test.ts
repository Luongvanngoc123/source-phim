import { describe, expect, it } from "vitest";
import {
  cardCaption,
  clockOf,
  countText,
  countdownText,
  episodeLabel,
  episodeTitle,
  parseProgress,
  playLabel,
  statusLine,
  subtitleCues,
  viewCount,
  vnDayMonth,
  vnWeekday,
} from "./format";
import type { AnimeDetail, AnimeListItem } from "../api/types";

const item = (overrides: Partial<AnimeListItem> = {}): AnimeListItem => ({
  title: "",
  slug: "",
  film_id: null,
  url: "",
  poster: "",
  episode_badge: null,
  schedule_badge: null,
  countdown_seconds: null,
  air_time: null,
  rating: null,
  quality: null,
  progress: null,
  year: null,
  views_or_subtitle: null,
  description: null,
  studio: null,
  genres: [],
  detail_api: "",
  ...overrides,
});

const detail = (
  episodes: AnimeDetail["episodes"],
  duration: string | null,
): Pick<AnimeDetail, "episodes" | "duration"> => ({ episodes, duration });

describe("format rules", () => {
  it.each([
    ["01", "1"],
    ["09", "9"],
    ["104", "104"],
    ["1265_END", "1265 (cuối)"],
    ["624-625", "624-625"],
    ["12.5", "12.5"],
    ["Full", "Full"],
  ])("formats episode label %s", (raw, expected) => {
    expect(episodeLabel(raw)).toBe(expected);
  });

  it.each([
    ["01", "Tập 1"],
    ["Full", "Bản đầy đủ"],
    ["TẬP FULL", "Bản đầy đủ"],
    ["12.5", "Tập 12.5"],
  ])("formats episode title %s", (raw, expected) => {
    expect(episodeTitle(raw)).toBe(expected);
  });

  it.each([
    ["09", "Xem tập 9"],
    ["624-625", "Xem tập 624-625"],
    ["1265_END", "Xem tập 1265 (cuối)"],
    ["Full", "Xem bản đầy đủ"],
  ])("labels the play action for %s", (raw, expected) => {
    expect(playLabel(raw)).toBe(expected);
  });

  it.each([
    ["07/13", { aired: 7, total: 13 }],
    ["09/??", { aired: 9, total: null }],
    ["104/??", { aired: 104, total: null }],
    ["PV/??", { aired: null, total: null }],
    ["12.5/13", { aired: null, total: 13 }],
    ["", { aired: null, total: null }],
    [null, { aired: null, total: null }],
  ])("parses progress %s", (raw, expected) => {
    expect(parseProgress(raw)).toEqual(expected);
  });

  it.each([
    [item({ episode_badge: "TẬP 09" }), "Tập 9"],
    [item({ episode_badge: "TẬP FULL" }), "Bản đầy đủ"],
    [item({ episode_badge: "HOÀN TẤT", progress: "24/24" }), "Trọn bộ 24 tập"],
    [item({ episode_badge: "HOÀN TẤT", progress: "24/??" }), "Hoàn tất"],
    [item({ episode_badge: "HOÀN TẤT" }), "Hoàn tất"],
    [item({ progress: "03/03" }), "Trọn bộ 3 tập"],
    [item({ progress: "07/12" }), "Tập 7"],
    [item({ progress: "12.5/13" }), null],
    [item({ schedule_badge: "SẮP CHIẾU", air_time: "2027" }), "Sắp chiếu 2027"],
    [item({ progress: "PV/??" }), "Sắp chiếu"],
    [item(), null],
  ])("formats card caption", (input, expected) => {
    expect(cardCaption(input)).toBe(expected);
  });

  it("keeps a text that fits as one cue", () => {
    expect(subtitleCues("Một câu. Câu hai.")).toEqual(["Một câu. Câu hai."]);
    expect(subtitleCues("Một câu, tiếp tục phần sau.")).toEqual([
      "Một câu, tiếp tục phần sau.",
    ]);
    expect(subtitleCues("")).toEqual([]);
  });

  it("cuts long text at a clause boundary, else between words, never inside one", () => {
    expect(
      subtitleCues("Mùa hai bắt đầu, cả đội lên đường ngay.", 2, 20),
    ).toEqual(["Mùa hai bắt đầu,", "cả đội lên đường"]);
    expect(subtitleCues("Mô tả không có điểm ngắt nào", 2, 10)).toEqual([
      "Mô tả",
      "không có",
    ]);
    expect(subtitleCues("aaaaaaaaaaaaaaaa", 2, 10)).toEqual([
      "aaaaaaaaaa",
      "aaaaaa",
    ]);
  });

  it.each([
    ["Lượt xem: 1,491,367", "1.491.367 lượt xem"],
    ["phụ đề khác", null],
    [null, null],
  ])("formats view count", (raw, expected) => {
    expect(viewCount(raw)).toBe(expected);
  });

  it.each([
    ["2,170,789 Lượt Xem", "2.170.789"],
    ["Lượt xem: 1,491,367", "1.491.367"],
    ["6,733", "6.733"],
    ["616", "616"],
    ["Không có số", null],
    [null, null],
  ])("formats a count from %s", (raw, expected) => {
    expect(countText(raw)).toBe(expected);
  });

  it("uses UTC date parts for Vietnamese dates", () => {
    expect(vnWeekday("2026-11-25")).toBe("Thứ Tư");
    expect(vnWeekday("2027-01-01")).toBe("Thứ Sáu");
    expect(vnDayMonth("2026-11-25")).toBe("25/11");
    expect(vnDayMonth("")).toBe("");
    expect(clockOf("2026-11-25T21:00:00+07:00")).toBe("21:00");
  });

  it.each([
    [2 * 86_400 + 6 * 3_600 + 38 * 60 + 7, true, "còn 2 ngày 06:38:07"],
    [6 * 3_600 + 38 * 60, false, "còn 6 giờ"],
    [38 * 60, false, "còn 38 phút"],
    [0, false, "đã lên sóng"],
    [-3, true, "đã lên sóng"],
    [Number.NaN, false, "đã lên sóng"],
  ])("formats countdown", (seconds, precise, expected) => {
    expect(countdownText(seconds, precise)).toBe(expected);
  });

  it("formats status lines", () => {
    const episode = {
      episode: "09",
      title: "Tập 09",
      episode_id: "9",
      source: "",
      watch_url: "",
    };
    expect(statusLine(detail([], ""))).toBe("Sắp chiếu, chưa có tập nào.");
    expect(statusLine(detail([episode], null))).toBe("Tập 9 đã có vietsub.");
    expect(statusLine(detail([episode], "09/??"))).toBe("Tập 9 đã có vietsub.");
    expect(statusLine(detail([episode], "01/01"))).toBe("Trọn bộ 1 tập.");
  });
});
