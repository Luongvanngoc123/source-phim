import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
// @ts-expect-error Node 26 executes TypeScript files and resolves this extension.
import { stripAdBreaks } from "./adfilter.ts";

const fixtureDirectory = fileURLToPath(new URL("./__fixtures__/", import.meta.url));

function segmentUris(playlist: string): string[] {
  const lines = playlist.split(/\r?\n/);
  const uris: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startsWith("#EXTINF:")) {
      uris.push(lines[index + 1]);
      index += 1;
    }
  }
  return uris;
}

for (const fixture of ["v1.m3u8", "v2.m3u8"]) {
  test(`${fixture} removes the structural ad runs`, async () => {
    const source = await readFile(`${fixtureDirectory}${fixture}`, "utf8");
    const result = stripAdBreaks(source);
    assert.equal(result.removed.length, 7);
    assert.equal(result.removed.filter((run) => run.duration < 10).length, 6);
    assert.ok(result.removed.some((run) => Math.abs(run.duration - 34.7) < 0.01));
    assert.ok(
      Math.abs(
        result.removed.reduce((sum, run) => sum + run.duration, 0) -
          (fixture === "v1.m3u8" ? 57.734 : 57.534),
      ) < 0.01,
    );
    assert.match(result.playlist, /#EXT-X-ENDLIST/);

    const originalFilmSegments = segmentUris(source).filter((uri) => !uri.includes("/"));
    const filteredFilmSegments = segmentUris(result.playlist).filter((uri) => !uri.includes("/"));
    assert.deepEqual(filteredFilmSegments, originalFilmSegments);
    assert.equal(result.playlist.includes("convertv9/"), false);
    assert.equal(result.playlist.includes("/v9/"), false);
  });
}

test("re-emits the key and map in force after an encrypted break", () => {
  const source = [
    "#EXTM3U",
    '#EXT-X-KEY:METHOD=AES-128,URI="first.key"',
    "#EXTINF:100,",
    "film-1.ts",
    "#EXT-X-DISCONTINUITY",
    '#EXT-X-KEY:METHOD=AES-128,URI="ad.key"',
    "#EXTINF:10,",
    "ads/ad.ts",
    "#EXT-X-DISCONTINUITY",
    "#EXT-X-KEY:METHOD=NONE",
    '#EXT-X-MAP:URI="film.mp4"',
    "#EXTINF:100,",
    "film-2.ts",
    "#EXT-X-ENDLIST",
  ].join("\n");
  const result = stripAdBreaks(source);
  assert.equal(result.removed.length, 1);
  assert.equal(result.playlist.includes("ads/ad.ts"), false);
  assert.match(
    result.playlist,
    /#EXT-X-DISCONTINUITY\n#EXT-X-KEY:METHOD=NONE\n#EXT-X-MAP:URI="film\.mp4"\n#EXTINF:100,/,
  );
});

test("leaves a playlist with one URI directory unchanged", () => {
  const source = [
    "#EXTM3U",
    "#EXTINF:10,",
    "one.ts",
    "#EXT-X-DISCONTINUITY",
    "#EXTINF:10,",
    "two.ts",
    "#EXT-X-ENDLIST",
  ].join("\n");
  const result = stripAdBreaks(source);
  assert.deepEqual(result, { playlist: source, removed: [] });
});

test("leaves master playlists unchanged", () => {
  const source = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nmedia.m3u8\n";
  assert.deepEqual(stripAdBreaks(source), { playlist: source, removed: [] });
});

test("does not remove more than one fifth of the playlist", () => {
  const source = [
    "#EXTM3U",
    "#EXTINF:40,",
    "film-1.ts",
    "#EXT-X-DISCONTINUITY",
    "#EXTINF:25,",
    "ads/ad.ts",
    "#EXT-X-DISCONTINUITY",
    "#EXTINF:40,",
    "film-2.ts",
    "#EXT-X-ENDLIST",
  ].join("\n");
  assert.deepEqual(stripAdBreaks(source), { playlist: source, removed: [] });
});
