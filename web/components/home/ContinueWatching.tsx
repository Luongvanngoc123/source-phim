import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { getProgress } from "@/lib/account";
import type { ProgressEntry } from "@/lib/account";
import { getLocalProgress, latestFilmProgress } from "@/lib/progress";
import { paths } from "@/lib/paths";

const LOCAL_EVENT = "animora-progress-changed";

export default function ContinueWatching(): ReactElement | null {
  const { user, loading } = useAuth();
  const [entries, setEntries] = useState<ProgressEntry[]>([]);

  useEffect(() => {
    if (loading) return undefined;
    let active = true;
    const load = async () => {
      const values = user ? await getProgress() : getLocalProgress();
      const visible = latestFilmProgress(values)
        .filter(
          (entry) =>
            entry.position >= 30 && (entry.duration <= 0 || entry.duration - entry.position >= 60),
        )
        .slice(0, 12);
      if (active) setEntries(visible);
    };
    void load().catch(() => {
      if (active) setEntries([]);
    });
    const refresh = () => void load();
    window.addEventListener(LOCAL_EVENT, refresh);
    return () => {
      active = false;
      window.removeEventListener(LOCAL_EVENT, refresh);
    };
  }, [loading, user?.id]);

  if (entries.length === 0) return null;
  return (
    <section className="mb-2">
      <div className="flex items-center gap-3 mb-5">
        <h2 className="text-white text-lg lg:text-xl xl:text-2xl font-semibold">Xem tiếp</h2>
        <Link href={paths.continueWatching} className="text-xs text-gray-400 hover:text-primary">
          Xem tất cả
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {entries.map((entry) => {
          const percent =
            entry.duration > 0
              ? Math.min(100, Math.max(0, (entry.position / entry.duration) * 100))
              : 0;
          return (
            <Link
              key={`${entry.film.id}-${entry.episode.slug}`}
              href={paths.watch(entry.film.id, entry.episode.slug)}
              className="flex gap-4 rounded-xl bg-white/5 p-3 hover:bg-white/10 transition-colors"
            >
              <Image
                src={entry.film.banner || entry.film.poster}
                alt={entry.film.title}
                width={220}
                height={124}
                className="w-40 sm:w-44 aspect-video object-cover rounded-lg"
              />
              <span className="min-w-0 flex-1 py-1">
                <strong className="block text-white text-sm truncate">{entry.film.title}</strong>
                <span className="block text-gray-400 text-xs mt-2 truncate">
                  {entry.episode.name}
                </span>
                <span className="block h-1 bg-gray-700 rounded-full mt-5 overflow-hidden">
                  <span className="block h-full bg-primary" style={{ width: `${percent}%` }} />
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
