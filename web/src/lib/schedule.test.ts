import { describe, expect, it } from "vitest";
import { airingsOf, nextEpisodeText, serverOffsetSeconds } from "./schedule";
import type { ScheduleItem, ScheduleResponse } from "../api/types";

const item = (overrides: Partial<ScheduleItem> = {}): ScheduleItem => ({
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

const response = (
  schedule: ScheduleResponse["schedule"],
): ScheduleResponse => ({
  success: true,
  generated_at_unix: 1_700_000_000,
  server_time_unix: 1_700_000_100,
  day_count: schedule.length,
  schedule,
});

describe("schedule rules", () => {
  it("returns timed airings in chronological order", () => {
    const later = item({
      slug: "later",
      air_at: "2026-11-26T21:00:00+07:00",
      air_at_unix: 1_795_599_600,
    });
    const earlier = item({
      slug: "earlier",
      air_at: "2026-11-25T21:00:00+07:00",
      air_at_unix: 1_795_513_200,
    });
    const untimed = item({ slug: "untimed" });

    const result = airingsOf(
      response([
        { day: "", date: null, count: 2, items: [later, untimed] },
        { day: "", date: null, count: 1, items: [earlier] },
      ]),
    );

    expect(result.map((airing) => airing.slug)).toEqual(["earlier", "later"]);
  });

  it("uses the server clock at response receipt", () => {
    expect(serverOffsetSeconds(response([]), 1_700_000_000_000)).toBe(100);
    expect(
      serverOffsetSeconds(
        { ...response([]), server_time_unix: undefined },
        1_700_000_000_000,
      ),
    ).toBe(0);
  });

  it.each([
    ["07/13", "tập 8"],
    ["09/??", "tập 10"],
    ["PV/??", null],
    [null, null],
  ])("gets the next episode from %s", (progress, expected) => {
    expect(nextEpisodeText(item({ progress }))).toBe(expected);
  });
});
