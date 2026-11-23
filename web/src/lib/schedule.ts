import type { ScheduleItem, ScheduleResponse } from "../api/types";
import { parseProgress } from "./format";

/** A schedule item whose airing time the engine could resolve. */
export type TimedAiring = ScheduleItem & {
  air_at: string;
  air_at_unix: number;
};

function isTimed(item: ScheduleItem): item is TimedAiring {
  return (
    typeof item.air_at_unix === "number" && typeof item.air_at === "string"
  );
}

/** Every airing of the week that has a resolved time, earliest first. */
export function airingsOf(response: ScheduleResponse): TimedAiring[] {
  return response.schedule
    .flatMap((day) => day.items)
    .filter(isTimed)
    .sort((a, b) => a.air_at_unix - b.air_at_unix);
}

/**
 * Seconds to add to the device clock to get the server clock, so countdowns stay right on a
 * device whose clock is off. `fetchedAtMs` is when the response arrived (`query.dataUpdatedAt`).
 */
export function serverOffsetSeconds(
  response: ScheduleResponse,
  fetchedAtMs: number,
): number {
  if (typeof response.server_time_unix !== "number") {
    return 0;
  }
  return response.server_time_unix - Math.floor(fetchedAtMs / 1000);
}

/** "tập 8" for an item whose progress is "07/13"; null when the progress is not a number. */
export function nextEpisodeText(item: ScheduleItem): string | null {
  const { aired } = parseProgress(item.progress);
  return aired === null ? null : `tập ${aired + 1}`;
}
