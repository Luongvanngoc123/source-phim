export interface RemovedAdBreak {
  start: number;
  duration: number;
}

export interface AdFilterResult {
  playlist: string;
  removed: RemovedAdBreak[];
}

interface Segment {
  duration: number;
  uri: string;
  directory: string;
  extinfIndex: number;
  uriIndex: number;
  blockStart: number;
  blockEnd: number;
  timelineStart: number;
}

function uriDirectory(uri: string): string {
  const withoutQuery = uri.split(/[?#]/, 1)[0];
  const slash = withoutQuery.lastIndexOf("/");
  return slash < 0 ? "." : withoutQuery.slice(0, slash) || "/";
}

function isMasterPlaylist(lines: string[]): boolean {
  return lines.some(
    (line) =>
      line.startsWith("#EXT-X-STREAM-INF:") ||
      line.startsWith("#EXT-X-I-FRAME-STREAM-INF:") ||
      line.startsWith("#EXT-X-MEDIA:"),
  );
}

function parseSegments(lines: string[]): Segment[] {
  const segments: Segment[] = [];
  let previousUriIndex = -1;
  let timelineStart = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("#EXTINF:")) {
      continue;
    }
    const durationText = line.slice("#EXTINF:".length).split(",", 1)[0];
    const duration = Number.parseFloat(durationText);
    const uriIndex = index + 1;
    const uri = lines[uriIndex];
    if (!Number.isFinite(duration) || typeof uri !== "string" || uri.startsWith("#")) {
      continue;
    }
    segments.push({
      duration,
      uri,
      directory: uriDirectory(uri),
      extinfIndex: index,
      uriIndex,
      blockStart: previousUriIndex < 0 ? index : previousUriIndex + 1,
      blockEnd: uriIndex + 1,
      timelineStart,
    });
    timelineStart += duration;
    previousUriIndex = uriIndex;
    index = uriIndex;
  }

  return segments;
}

function updateState(lines: string[], state: { key: string | null; map: string | null }): void {
  for (const line of lines) {
    if (line.startsWith("#EXT-X-KEY:")) {
      state.key = line;
    } else if (line.startsWith("#EXT-X-MAP:")) {
      state.map = line;
    }
  }
}

function isStateTag(line: string): boolean {
  return line.startsWith("#EXT-X-KEY:") || line.startsWith("#EXT-X-MAP:");
}

function blockAfterRemoval(
  block: string[],
  state: { key: string | null; map: string | null },
): string[] {
  const withoutBreakState = block.filter(
    (line) => line !== "#EXT-X-DISCONTINUITY" && !isStateTag(line),
  );
  const segmentIndex = withoutBreakState.findIndex((line) => line.startsWith("#EXTINF:"));
  const insertion = segmentIndex < 0 ? withoutBreakState.length : segmentIndex;
  const tags = ["#EXT-X-DISCONTINUITY"];
  if (state.key !== null) {
    tags.push(state.key);
  }
  if (state.map !== null) {
    tags.push(state.map);
  }
  withoutBreakState.splice(insertion, 0, ...tags);
  return withoutBreakState;
}

/** Remove short, discontinuity-delimited URI-directory runs that are not film content. */
export function stripAdBreaks(playlist: string): AdFilterResult {
  const lines = playlist.split(/\r?\n/);
  if (isMasterPlaylist(lines)) {
    return { playlist, removed: [] };
  }

  const segments = parseSegments(lines);
  if (segments.length === 0 || !lines.includes("#EXT-X-DISCONTINUITY")) {
    return { playlist, removed: [] };
  }

  const durations = new Map<string, number>();
  for (const segment of segments) {
    durations.set(segment.directory, (durations.get(segment.directory) ?? 0) + segment.duration);
  }
  const filmDirectory = [...durations.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  if (filmDirectory === undefined) {
    return { playlist, removed: [] };
  }
  const runs: {
    first: number;
    last: number;
    duration: number;
    start: number;
    directories: Set<string>;
  }[] = [];
  let first = 0;
  for (let index = 1; index <= segments.length; index += 1) {
    const startsRun =
      index < segments.length &&
      lines
        .slice(segments[index].blockStart, segments[index].extinfIndex)
        .includes("#EXT-X-DISCONTINUITY");
    if (!startsRun && index < segments.length) {
      continue;
    }
    const run = segments.slice(first, index);
    runs.push({
      first,
      last: index - 1,
      duration: run.reduce((total, segment) => total + segment.duration, 0),
      start: run[0].timelineStart,
      directories: new Set(run.map((segment) => segment.directory)),
    });
    first = index;
  }

  const removedRuns = runs.filter(
    (run) =>
      [...run.directories].every((directory) => directory !== filmDirectory) && run.duration <= 120,
  );

  const totalDuration = segments.reduce((total, segment) => total + segment.duration, 0);
  const removedDuration = removedRuns.reduce((total, run) => total + run.duration, 0);
  if (removedRuns.length === 0 || removedDuration > totalDuration / 5) {
    return { playlist, removed: [] };
  }

  const removedIndexes = new Set<number>();
  for (const run of removedRuns) {
    for (let index = run.first; index <= run.last; index += 1) {
      removedIndexes.add(index);
    }
  }

  const output: string[] = lines.slice(0, segments[0].blockStart);
  const state = { key: null as string | null, map: null as string | null };
  // A key or init section declared in the header stays in force until a segment replaces it.
  updateState(output, state);
  let removedPending = false;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const block = lines.slice(segment.blockStart, segment.blockEnd);
    updateState(block, state);
    if (removedIndexes.has(index)) {
      removedPending = true;
      continue;
    }
    if (removedPending) {
      output.push(...blockAfterRemoval(block, state));
      removedPending = false;
    } else {
      output.push(...block);
    }
  }
  output.push(...lines.slice(segments.at(-1)?.blockEnd ?? lines.length));

  return {
    playlist: output.join("\n"),
    removed: removedRuns.map(({ start, duration }) => ({ start, duration })),
  };
}
