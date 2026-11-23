import { useEffect, useMemo, useState } from "react";
import type { AnimeListItem } from "../../api/types";
import { useAnime } from "../../api/queries";
import { ButtonLink, Screen, SubtitleLine } from "../../components";
import { paths } from "../../app/paths";
import { playLabel, statusLine, subtitleCues } from "../../lib/format";
import { FeaturedList } from "./FeaturedList";
import styles from "./Hero.module.css";

type HeroProps = {
  featured: AnimeListItem[];
};

type CueState = {
  slug: string | undefined;
  index: number;
};

export function Hero({ featured }: HeroProps) {
  const [selectedSlug, setSelectedSlug] = useState<string | undefined>();
  const selected =
    featured.find((item) => item.slug === selectedSlug) ?? featured[0];
  const detail = useAnime(selected?.slug);
  const description = detail.data?.description ?? "";
  const cues = useMemo(() => subtitleCues(description), [description]);
  const [cueState, setCueState] = useState<CueState>({
    slug: undefined,
    index: 0,
  });

  useEffect(() => {
    const slug = selected?.slug;

    if (!slug || cues.length === 0) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    let cueIndex = 0;
    let timer = window.setTimeout(startCues, 0);

    function startCues() {
      setCueState({ slug, index: cueIndex });
      timer = window.setTimeout(advanceCue, 2400);
    }

    function advanceCue() {
      cueIndex += 1;
      setCueState({ slug, index: cueIndex });
      if (cueIndex < cues.length) {
        timer = window.setTimeout(advanceCue, 2400);
      }
    }

    return () => window.clearTimeout(timer);
  }, [cues, selected?.slug]);

  const settledLine = detail.data
    ? statusLine(detail.data)
    : "Đang tải thông tin phim…";
  const currentCue =
    cueState.slug === selected?.slug && cueState.index < cues.length
      ? cues[cueState.index]
      : null;
  const image = detail.data?.banner || selected?.poster || null;
  const fit = detail.data?.banner ? "cover" : "contain";
  const newest = detail.data?.episodes.at(-1);
  const facts = heroFacts(selected, detail.data?.studio, detail.data?.schedule);

  return (
    <section className={styles.hero} aria-labelledby="home-title">
      <div className={styles.screenColumn}>
        <Screen image={image} fit={fit} alt="">
          {currentCue ? (
            <div aria-hidden="true">
              <SubtitleLine>{currentCue}</SubtitleLine>
            </div>
          ) : (
            <SubtitleLine live>{settledLine}</SubtitleLine>
          )}
          {description ? (
            <p className="visually-hidden">{description}</p>
          ) : null}
        </Screen>
        <h1 id="home-title">{selected?.title ?? "Animora"}</h1>
        {facts ? <p className={styles.facts}>{facts}</p> : null}
        <div className={styles.actions}>
          {selected && newest ? (
            <ButtonLink
              variant="play"
              to={paths.watch(selected.slug, newest.episode_id)}
            >
              {playLabel(newest.episode)}
            </ButtonLink>
          ) : null}
          {selected ? (
            <ButtonLink to={paths.anime(selected.slug)}>
              Thông tin phim
            </ButtonLink>
          ) : null}
        </div>
      </div>
      <FeaturedList
        items={featured}
        selectedSlug={selected?.slug}
        onSelect={setSelectedSlug}
      />
    </section>
  );
}

function heroFacts(
  selected: AnimeListItem | undefined,
  studio: string | null | undefined,
  schedule: string | null | undefined,
): string {
  const studioName = studio || selected?.studio;
  const parts: string[] = [];
  if (studioName) {
    const prefix = /^studio\b/i.test(studioName) ? "" : "Studio ";
    parts.push(`${prefix}${studioName}.`);
  }
  const scheduleText = formatSchedule(schedule);
  if (scheduleText) {
    parts.push(scheduleText);
  }
  return parts.join(" ");
}

function formatSchedule(schedule: string | null | undefined): string | null {
  if (!schedule) {
    return null;
  }
  const match = schedule.match(
    /^(.+?)\s+vào lúc\s+(\d{1,2})\s+giờ(?:\s+(\d{1,2})\s+phút)?\s+hàng tuần$/i,
  );
  if (!match) {
    return null;
  }
  const hour = Number(match[2]);
  const minute = Number(match[3] ?? 0);
  const clock = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const weekday = formatWeekday(match[1]);
  return `Tập mới ${weekday} lúc ${clock}.`;
}

function formatWeekday(value: string): string {
  const weekday = value.trim();
  if (/^chủ nhật$/i.test(weekday)) {
    return "chủ nhật";
  }
  if (/^thứ\s/i.test(weekday)) {
    return `thứ ${weekday.slice(4)}`;
  }
  return weekday;
}
