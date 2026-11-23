import { Link } from "react-router";
import { useSchedule } from "../../api/queries";
import { paths } from "../../app/paths";
import { usePageTitle } from "../../app/usePageTitle";
import { Countdown, Notice, Poster } from "../../components";
import {
  clockOf,
  countdownText,
  parseProgress,
  vnDayMonth,
  vnWeekday,
} from "../../lib/format";
import {
  airingsOf,
  nextEpisodeText,
  serverOffsetSeconds,
} from "../../lib/schedule";
import type { ScheduleDay, ScheduleItem } from "../../api/types";
import styles from "./SchedulePage.module.css";
import type { ReactNode } from "react";

type ScheduleRowProps = {
  item: ScheduleItem;
  nowUnix: number;
  nextAirKey: string | undefined;
  nowOffset: number;
};

function ScheduleRow({
  item,
  nowUnix,
  nextAirKey,
  nowOffset,
}: ScheduleRowProps) {
  const airAtText = typeof item.air_at === "string" ? item.air_at : null;
  const airAt =
    airAtText && typeof item.air_at_unix === "number" ? item.air_at_unix : null;
  const isFuture = airAt !== null && airAt > nowUnix;
  const itemKey = airAt === null ? item.slug : `${item.slug}-${airAt}`;
  const isNext = isFuture && itemKey === nextAirKey;
  const parsed = parseProgress(item.progress);
  const episode = nextEpisodeText(item);
  const aired =
    parsed.total !== null && parsed.aired !== null
      ? `đã chiếu ${parsed.aired}/${parsed.total}`
      : null;
  const whatAirs = [episode, aired].filter(Boolean).join(", ");
  const time = airAtText ? clockOf(airAtText) : item.air_time || "—";
  let airingStatus: ReactNode = null;
  if (airAt !== null && isFuture) {
    airingStatus = isNext ? (
      <Countdown toUnix={airAt} live nowOffset={nowOffset} />
    ) : (
      <span className={styles.staticCountdown}>
        {countdownText(airAt - nowUnix, false)}
      </span>
    );
  } else if (airAt !== null) {
    airingStatus = <span className={styles.past}>đã lên sóng</span>;
  }

  return (
    <li className={styles.row}>
      <div className={styles.timeBlock}>
        <span className={`${styles.clock} font-figure`}>{time}</span>
        {airingStatus}
      </div>
      <div className={styles.titleBlock}>
        <Link className={styles.titleLink} to={paths.anime(item.slug)}>
          <Poster src={item.poster} title={item.title} sizes="56px" />
          <span>
            <strong>{item.title}</strong>
            {whatAirs ? (
              <span className={styles.whatAirs}>{whatAirs}</span>
            ) : null}
          </span>
        </Link>
      </div>
    </li>
  );
}

function DaySection({
  day,
  today,
  nowUnix,
  nextAirKey,
  nowOffset,
}: {
  day: ScheduleDay;
  today: boolean;
  nowUnix: number;
  nextAirKey: string | undefined;
  nowOffset: number;
}) {
  const label = day.date
    ? `${vnWeekday(day.date)} ${vnDayMonth(day.date)}`
    : day.day;

  return (
    <section className={`${styles.day} ${today ? styles.today : ""}`}>
      <h2>
        {label}
        {today ? <span className={styles.todayTag}>hôm nay</span> : null}
      </h2>
      {day.items.length ? (
        <ul className={styles.rows}>
          {day.items.map((item) => (
            <ScheduleRow
              key={`${day.date ?? day.day}-${item.slug}`}
              item={item}
              nowUnix={nowUnix}
              nextAirKey={nextAirKey}
              nowOffset={nowOffset}
            />
          ))}
        </ul>
      ) : (
        <p className={styles.noItems}>Không có tập mới.</p>
      )}
    </section>
  );
}

export function SchedulePage() {
  const query = useSchedule();
  usePageTitle("Lịch chiếu");

  if (query.isFetching && !query.data) {
    return (
      <section className={styles.page}>
        <h1>Lịch chiếu tuần này</h1>
        <Notice kind="loading" title="Đang tải lịch chiếu…" />
      </section>
    );
  }

  if (query.isError || !query.data) {
    return (
      <section className={styles.page}>
        <h1>Lịch chiếu tuần này</h1>
        <Notice
          kind="error"
          title="Không tải được dữ liệu. Kiểm tra kết nối rồi thử lại."
          action={{ label: "Thử lại", onClick: () => void query.refetch() }}
        />
      </section>
    );
  }

  const offset = serverOffsetSeconds(query.data, query.dataUpdatedAt);
  const nowUnix = Math.floor(query.dataUpdatedAt / 1000) + offset;
  const timedAirings = airingsOf(query.data);
  const nextAir = timedAirings.find((item) => item.air_at_unix > nowUnix);
  const nextAirKey = nextAir
    ? `${nextAir.slug}-${nextAir.air_at_unix}`
    : undefined;
  const today = new Date((nowUnix + 7 * 60 * 60) * 1000)
    .toISOString()
    .slice(0, 10);

  return (
    <section className={styles.page}>
      <h1>Lịch chiếu tuần này</h1>
      <div className={styles.agenda}>
        {query.data.schedule.map((day) => (
          <DaySection
            key={day.date ?? day.day}
            day={day}
            today={day.date === today}
            nowUnix={nowUnix}
            nextAirKey={nextAirKey}
            nowOffset={offset}
          />
        ))}
      </div>
    </section>
  );
}
