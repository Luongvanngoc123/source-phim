import { useMemo } from "react";
import { Link } from "react-router";
import { useSchedule } from "../../api/queries";
import type { ScheduleResponse } from "../../api/types";
import { Countdown, Notice, SectionHeading } from "../../components";
import { paths } from "../../app/paths";
import { clockOf, vnDayMonth, vnWeekday } from "../../lib/format";
import {
  airingsOf,
  nextEpisodeText,
  serverOffsetSeconds,
  type TimedAiring,
} from "../../lib/schedule";
import styles from "./AiringSchedule.module.css";

export function AiringSchedule() {
  const schedule = useSchedule();
  const offset = schedule.data
    ? serverOffsetSeconds(schedule.data, schedule.dataUpdatedAt)
    : 0;
  const upcoming = useMemo(() => {
    if (!schedule.data) {
      return [];
    }
    const now = Math.floor(schedule.dataUpdatedAt / 1000) + offset;
    return airingsOf(schedule.data)
      .filter((item) => item.air_at_unix > now)
      .slice(0, 4);
  }, [offset, schedule.data, schedule.dataUpdatedAt]);

  return (
    <section className={styles.section}>
      <SectionHeading
        title="Sắp lên sóng"
        action={{ label: "Xem lịch cả tuần", to: paths.schedule() }}
      />
      {renderScheduleContent(
        schedule.isFetching && !schedule.data,
        schedule.isError,
        schedule.data,
        upcoming,
        offset,
        () => void schedule.refetch(),
      )}
    </section>
  );
}

function renderScheduleContent(
  isPending: boolean,
  isError: boolean,
  data: ScheduleResponse | undefined,
  upcoming: TimedAiring[],
  offset: number,
  onRetry: () => void,
) {
  if (isPending) {
    return <ScheduleSkeleton />;
  }
  if (isError || !data) {
    return (
      <Notice
        kind="error"
        title="Không tải được dữ liệu. Kiểm tra kết nối rồi thử lại."
        action={{ label: "Thử lại", onClick: onRetry }}
      />
    );
  }
  if (upcoming.length === 0) {
    return <p className={styles.empty}>Tuần này không còn tập nào lên sóng.</p>;
  }
  return (
    <div className={styles.airings}>
      {upcoming.map((item, index) => (
        <AiringRow
          key={`${item.slug}-${item.air_at}`}
          item={item}
          live={index === 0}
          nowOffset={offset}
        />
      ))}
    </div>
  );
}

type AiringRowProps = {
  item: TimedAiring;
  live: boolean;
  nowOffset: number;
};

function AiringRow({ item, live, nowOffset }: AiringRowProps) {
  const date = item.air_date ?? item.air_at.slice(0, 10);
  const nextEpisode = nextEpisodeText(item);

  return (
    <div className={styles.airing}>
      <time className={styles.date} dateTime={date}>
        <span>{vnWeekday(date)}</span>
        <span>{vnDayMonth(date)}</span>
      </time>
      <time className={`${styles.clock} font-figure`} dateTime={item.air_at}>
        {clockOf(item.air_at)}
      </time>
      <Link className={styles.title} to={paths.anime(item.slug)}>
        {item.title}
      </Link>
      <span className={styles.episode}>{nextEpisode ?? "Tập mới"}</span>
      <Countdown toUnix={item.air_at_unix} live={live} nowOffset={nowOffset} />
    </div>
  );
}

function ScheduleSkeleton() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
