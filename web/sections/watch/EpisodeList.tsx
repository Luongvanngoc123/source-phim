import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Play from "@/components/loading/play";
import { paths } from "@/lib/paths";

interface EpisodeListProps {
  episodes: IEpisode[];
  servers: IServer[];
  currentServerIndex: number;
  onServerChange: (serverIndex: number) => void;
  currentEpisodeId: string;
  slug: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  poster: string;
}

const RANGE_SIZE = 100;

function rangeLabel(start: number, end: number): string {
  return start === end ? `Tập ${start}` : `Tập ${start}–${end}`;
}

export default function EpisodeList({
  episodes,
  servers,
  currentServerIndex,
  onServerChange,
  currentEpisodeId,
  slug,
  collapsed,
  onToggleCollapsed,
  poster,
}: EpisodeListProps) {
  const ranges = useMemo(() => {
    const groups: IEpisode[][] = [];
    for (let index = 0; index < episodes.length; index += RANGE_SIZE) {
      groups.push(episodes.slice(index, index + RANGE_SIZE));
    }
    return groups;
  }, [episodes]);
  const currentIndex = episodes.findIndex((episode) => episode._id === currentEpisodeId);
  const currentRange = currentIndex < 0 ? 0 : Math.floor(currentIndex / RANGE_SIZE);
  const [openRange, setOpenRange] = useState(currentRange);

  useEffect(() => {
    setOpenRange(currentRange);
  }, [currentRange]);

  const visibleEpisodes = ranges[openRange] ?? [];
  const rangeStart = openRange * RANGE_SIZE + 1;
  const rangeEnd = rangeStart + visibleEpisodes.length - 1;

  return (
    <section>
      <div className="flex w-full items-start justify-between py-5 lg:items-center lg:py-8">
        <div className="flex flex-col items-start space-y-4 lg:flex-row lg:items-center lg:space-x-6 lg:space-y-0">
          <h2 className="flex items-center space-x-3 text-xl font-semibold text-white">
            <i className="fa-solid fa-bars-staggered text-primary" />
            <span>Tập phim</span>
          </h2>
          {servers.length > 1 && (
            <div className="flex max-w-full flex-wrap gap-2" aria-label="Chọn máy chủ">
              {servers.map((server, index) => (
                <button
                  key={`${server.name}-${index}`}
                  type="button"
                  aria-pressed={index === currentServerIndex}
                  onClick={() => onServerChange(index)}
                  className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${index === currentServerIndex ? "border-primary bg-primary/10 text-primary" : "border-gray-700 text-gray-400 hover:text-white"}`}
                >
                  {server.name}
                </button>
              ))}
            </div>
          )}
          {ranges.length > 1 && (
            <div className="flex max-w-full flex-wrap gap-2">
              {ranges.map((range, index) => {
                const start = index * RANGE_SIZE + 1;
                const end = start + range.length - 1;
                return (
                  <button
                    key={`${start}-${end}`}
                    type="button"
                    onClick={() => setOpenRange(index)}
                    className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${openRange === index ? "border-primary bg-primary/10 text-primary" : "border-gray-700 text-gray-400 hover:text-white"}`}
                  >
                    {rangeLabel(start, end)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button type="button" onClick={onToggleCollapsed} className="flex items-center space-x-2">
          <span className="text-[13px] text-white">Rút gọn</span>
          <span
            className={`relative flex h-[18px] w-[30px] flex-shrink-0 rounded-2xl border transition-colors duration-300 ${collapsed ? "border-primary bg-[#ffffff10]" : "border-gray-600"}`}
          >
            <span
              className={`absolute top-[4px] h-[8px] w-[8px] rounded-[20px] transition-all duration-300 ease-in-out ${collapsed ? "left-[18px] bg-primary" : "left-[4px] bg-gray-600"}`}
            />
          </span>
        </button>
      </div>

      {visibleEpisodes.length === 0 ? (
        <div className="mb-12 text-sm text-gray-400">Chưa có tập phim nào.</div>
      ) : (
        <>
          <div className="mb-3 text-xs text-gray-500">{rangeLabel(rangeStart, rangeEnd)}</div>
          {collapsed ? (
            <div className="mb-12 grid w-full grid-cols-4 gap-4 lg:grid-cols-6">
              {visibleEpisodes.map((episode) => {
                const active = episode._id === currentEpisodeId;
                return (
                  <Link
                    key={episode._id}
                    scroll={false}
                    href={paths.watch(slug, episode.slug)}
                    className={`flex items-center justify-center gap-2 rounded-md px-1 py-2.5 hover:text-primary md:py-3 lg:py-4 ${active ? "bg-primary/10 text-primary" : "bg-[#1c2343] text-white"}`}
                  >
                    {active ? <Play /> : <i className="fa-solid fa-play text-xs" />}
                    <span className="truncate">{episode.name}</span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="mb-12 grid w-full grid-cols-2 gap-4 lg:grid-cols-4">
              {visibleEpisodes.map((episode) => {
                const active = episode._id === currentEpisodeId;
                return (
                  <Link
                    key={episode._id}
                    scroll={false}
                    href={paths.watch(slug, episode.slug)}
                    className="group block"
                  >
                    <div className="relative mb-3.5 overflow-hidden">
                      <div className="relative h-0 w-full overflow-hidden rounded-lg bg-[#2F3346] pb-[56%]">
                        <div
                          className={`absolute left-1/2 top-1/2 z-10 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 pl-[2px] ${active ? "opacity-100" : "border border-white opacity-0 group-hover:opacity-100"}`}
                        >
                          {active ? (
                            <Play />
                          ) : (
                            <i className="fa-solid fa-play group-hover:text-primary" />
                          )}
                        </div>
                      </div>
                      <Image
                        src={poster}
                        alt={episode.name}
                        width={200}
                        height={200}
                        className={`absolute inset-0 h-full w-full object-contain ${active ? "opacity-50" : "group-hover:opacity-50"}`}
                      />
                    </div>
                    <div
                      className={`text-left text-sm ${active ? "text-primary" : "text-white group-hover:text-primary"}`}
                    >
                      {episode.name}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
