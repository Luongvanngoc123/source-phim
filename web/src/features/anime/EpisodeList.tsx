import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { paths } from "../../app/paths";
import { episodeLabel, episodeTitle } from "../../lib/format";
import type { Episode } from "../../api/types";
import styles from "./EpisodeList.module.css";

type EpisodeListProps = {
  slug: string;
  episodes: Episode[];
  currentEpisodeId?: string;
};

type EpisodeRange = {
  key: string;
  start: number;
  end: number;
  episodes: Episode[];
};

function makeRanges(episodes: Episode[]): EpisodeRange[] {
  const ranges: EpisodeRange[] = [];
  for (let start = 0; start < episodes.length; start += 100) {
    const rangeEpisodes = episodes.slice(start, start + 100);
    const end = start + rangeEpisodes.length;
    ranges.push({
      key: rangeEpisodes[0]?.episode_id ?? String(start),
      start: start + 1,
      end,
      episodes: rangeEpisodes,
    });
  }
  return ranges;
}

export function EpisodeList({
  slug,
  episodes,
  currentEpisodeId,
}: EpisodeListProps) {
  const ranges = useMemo(() => makeRanges(episodes), [episodes]);
  const currentIndex = episodes.findIndex(
    (episode) => episode.episode_id === currentEpisodeId,
  );
  const newestIndex = episodes.length - 1;
  const defaultIndex = currentIndex >= 0 ? currentIndex : newestIndex;
  const defaultRange = Math.max(0, Math.floor(defaultIndex / 100));
  const [openRange, setOpenRange] = useState(defaultRange);
  const currentLink = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    currentLink.current?.scrollIntoView({ block: "nearest" });
  }, [currentEpisodeId, openRange]);

  if (episodes.length === 0) {
    return null;
  }

  return (
    <section className={styles.list} aria-labelledby="episode-list-title">
      <h2 id="episode-list-title">Danh sách tập</h2>
      {ranges.length > 1 ? (
        <div className={styles.ranges} aria-label="Chọn khoảng tập">
          {ranges.map((range, index) => (
            <button
              className={styles.rangeButton}
              type="button"
              key={range.key}
              aria-pressed={openRange === index}
              onClick={() => setOpenRange(index)}
            >
              {range.start}–{range.end}
            </button>
          ))}
        </div>
      ) : null}
      <ul className={styles.episodes}>
        {(ranges[openRange]?.episodes ?? []).map((episode) => {
          const isCurrent = episode.episode_id === currentEpisodeId;
          return (
            <li key={episode.episode_id}>
              <Link
                className={isCurrent ? styles.current : undefined}
                to={paths.watch(slug, episode.episode_id)}
                aria-current={isCurrent ? "page" : undefined}
                aria-label={episodeTitle(episode.episode)}
                ref={isCurrent ? currentLink : undefined}
              >
                <span className="font-figure">
                  {episodeLabel(episode.episode)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
