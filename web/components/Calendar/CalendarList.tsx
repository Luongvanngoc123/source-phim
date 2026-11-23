"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Navigation } from "swiper/modules";
import "swiper/css";
import "swiper/css/navigation";
import Image from "next/image";
import Loader from "@/components/loading/list";
import EmptyState from "@/components/State/EmptyState";
import ErrorState from "@/components/State/ErrorState";
import Link from "next/link";
import icon from "@/types/icon";
import { errorMessage, getSchedule } from "@/lib/engine";
import { paths } from "@/lib/paths";
import { useAsync } from "@/lib/useAsync";
import type { ScheduleDay, ScheduleItem } from "@/types/engine";
import type { Swiper as SwiperType } from "swiper";

const TIME_ZONE = "Asia/Ho_Chi_Minh";

interface CalendarDay {
  displayDate: string;
  dayOfWeek: string;
  date: string;
}

const dateParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return {
    year: parts.find((part) => part.type === "year")?.value ?? "",
    month: parts.find((part) => part.type === "month")?.value ?? "",
    day: parts.find((part) => part.type === "day")?.value ?? "",
  };
};

const formatDate = (date: string) => {
  const [, month, day] = date.split("-");
  return `${day}/${month}`;
};

const getDayName = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat("vi-VN", {
    timeZone: TIME_ZONE,
    weekday: "long",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));

  return weekday.charAt(0).toUpperCase() + weekday.slice(1);
};

const getToday = (serverTimeUnix?: number) => {
  const date = serverTimeUnix === undefined ? new Date() : new Date(serverTimeUnix * 1000);
  const { year, month, day } = dateParts(date);
  return `${year}-${month}-${day}`;
};

const formatAirTime = (airAt?: string) => {
  if (!airAt) return null;
  const date = new Date(airAt);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};

const toCalendarDay = (day: ScheduleDay, today: string): CalendarDay | null => {
  if (!day.date) return null;
  return {
    date: day.date,
    displayDate: formatDate(day.date),
    dayOfWeek: day.date === today ? "Hôm nay" : getDayName(day.date),
  };
};

const CalendarList: React.FC = () => {
  const schedule = useAsync(getSchedule, []);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const prevRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLDivElement | null>(null);

  const today = schedule.data ? getToday(schedule.data.server_time_unix) : "";
  const days = useMemo(
    () =>
      schedule.data?.schedule
        .map((day) => toCalendarDay(day, today))
        .filter((day): day is CalendarDay => day !== null) ?? [],
    [schedule.data, today],
  );

  useEffect(() => {
    if (!schedule.data || selectedDate !== null) return;
    const today = getToday(schedule.data.server_time_unix);
    setSelectedDate(days.some((day) => day.date === today) ? today : (days[0]?.date ?? null));
  }, [days, schedule.data, selectedDate]);

  const selectedDay = schedule.data?.schedule.find((day) => day.date === selectedDate);
  const movies = useMemo(
    () =>
      [...(selectedDay?.items ?? [])].sort(
        (left, right) =>
          (left.air_at_unix ?? Number.MAX_SAFE_INTEGER) -
          (right.air_at_unix ?? Number.MAX_SAFE_INTEGER),
      ),
    [selectedDay],
  );

  if (schedule.error) {
    return <ErrorState message={errorMessage(schedule.error)} onRetry={schedule.reload} />;
  }

  if (schedule.loading || !schedule.data) {
    return <Loader />;
  }

  return (
    <div className="relative w-full">
      <Swiper
        modules={[Navigation]}
        spaceBetween={7}
        loop={false}
        slidesPerView={3}
        className="mySwiper"
        navigation={{
          prevEl: prevRef.current,
          nextEl: nextRef.current,
        }}
        onBeforeInit={(swiper: SwiperType) => {
          if (typeof swiper.params.navigation !== "boolean" && swiper.params.navigation) {
            const navigation = swiper.params.navigation;
            navigation.prevEl = prevRef.current;
            navigation.nextEl = nextRef.current;
          }
        }}
        breakpoints={{
          320: { slidesPerView: 3, spaceBetween: 5 },
          768: { slidesPerView: 5, spaceBetween: 7 },
          1024: { slidesPerView: 6, spaceBetween: 10 },
          1280: { slidesPerView: 7, spaceBetween: 15 },
        }}
      >
        {days.map((day) => {
          const isActive = selectedDate === day.date;
          return (
            <SwiperSlide key={day.date}>
              <div
                onClick={() => setSelectedDate(day.date)}
                role="button"
                aria-label={`Chọn ngày ${day.displayDate}`}
                className={`flex flex-col h-full py-2 md:py-4 px-2 md:px-5 border-t-[3px] cursor-pointer transition-colors
                  ${
                    isActive
                      ? "border-t-primary bg-[#ffffff10]"
                      : "border-t-transparent bg-[#ffffff06] hover:bg-[#ffffff0a]"
                  } justify-end`}
              >
                <p className="text-gray-400 text-xs md:text-sm lg:text-base">{day.displayDate}</p>
                <h3
                  className={`text-sm md:text-base lg:text-lg font-bold truncate mt-1 ${isActive ? "text-primary" : "text-white"}`}
                >
                  {day.dayOfWeek}
                </h3>
              </div>
            </SwiperSlide>
          );
        })}
      </Swiper>

      <div
        ref={prevRef}
        className="absolute z-30 top-[10px] lg:top-[2.2rem] -translate-y-1/2 left-[-43px] lg:w-9 lg:h-9 w-8 h-8 flex items-center justify-center rounded-full cursor-pointer transition-all shadow hover:scale-110"
        role="button"
        aria-label="Previous"
      >
        <icon.ArrowLeft className="text-gray-400 hover:text-white" width={32} height={32} />
      </div>
      <div
        ref={nextRef}
        className="absolute z-30 top-[10px] lg:top-[2.2rem] -translate-y-1/2 right-[-43px] lg:w-9 lg:h-9 w-8 h-8 flex items-center justify-center rounded-full cursor-pointer transition-all shadow hover:scale-110"
        role="button"
        aria-label="Next"
      >
        <icon.ArrowRight className="text-gray-400 hover:text-white" width={32} height={32} />
      </div>

      <div className="mt-6 flex flex-col space-y-6 w-full min-h-[200px]">
        {movies.length === 0 ? (
          <EmptyState message="Chưa có lịch chiếu cho ngày này." />
        ) : (
          <div className="relative flex items-start justify-between before:content-[''] before:absolute before:left-0 before:right-0 before:top-[29px] before:h-[2px] before:bg-[#ffffff10]">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 w-full px-0 md:px-4">
              {movies.map((item: ScheduleItem) => {
                const airTime = formatAirTime(item.air_at);
                return (
                  <div
                    key={`${item.slug}-${item.air_at ?? item.air_at_unix ?? "time"}`}
                    className="relative w-full flex"
                  >
                    <Link
                      href={paths.film(item.slug)}
                      className="relative text-sm px-3 py-2.5 bg-[#363840] rounded-lg border border-[#ffffff20] flex flex-row items-center w-full group hover:border-primary cursor-pointer"
                    >
                      <div className="w-[50px] flex-shrink-0">
                        <div className="pb-[150%] w-full rounded-md overflow-hidden relative h-0 block bg-[#222]">
                          <Image
                            src={item.poster}
                            alt={item.title}
                            fill
                            className="object-cover absolute top-0 left-0 bottom-0 right-0 h-full w-full group-hover:scale-110 transition-transform duration-300"
                            sizes="100px"
                            unoptimized
                          />
                        </div>
                      </div>
                      {airTime && (
                        <span className="absolute -top-3 text-xs leading-[1] px-1 py-0.5 rounded-[3px] text-white bg-primary">
                          {airTime}
                        </span>
                      )}

                      <div className="flex-grow ml-4">
                        <h4 className="mb-1.5 text-[13px] line-clamp-2 font-medium text-white group-hover:text-primary">
                          {item.title}
                        </h4>
                        {item.views_or_subtitle && (
                          <p className="text-[11px] text-[#aaa] line-clamp-1">
                            {item.views_or_subtitle}
                          </p>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-[0.9em] text-[#aaa] whitespace-nowrap">
                            {item.episode_badge ?? ""}
                          </span>
                        </div>
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CalendarList;
