import { useCallback, useEffect, useState } from "react";
import type { ReactNode, ReactElement } from "react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "react-hot-toast";
import { useAuth } from "@/context/AuthContext";
import { accountErrorMessage, clearProgress, getProgress, removeProgress } from "@/lib/account";
import type { ProgressEntry } from "@/lib/account";
import {
  clearLocalProgress,
  getLocalProgress,
  latestFilmProgress,
  removeLocalProgress,
} from "@/lib/progress";
import { paths } from "@/lib/paths";

export default function ContinuePage(): ReactElement {
  const { user, loading, openAuth } = useAuth();
  const [entries, setEntries] = useState<ProgressEntry[]>([]);
  // Films with any saved position. More than are listed: a film whose latest episode is
  // finished or barely started has nothing to continue, yet its position is still kept.
  const [storedFilms, setStoredFilms] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const values = user ? await getProgress() : getLocalProgress();
      const latest = latestFilmProgress(values);
      setStoredFilms(latest.length);
      setEntries(
        latest.filter(
          (entry) =>
            entry.position >= 30 && (entry.duration <= 0 || entry.duration - entry.position >= 60),
        ),
      );
    } catch (reason: unknown) {
      setError(accountErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (loading) return;
    void load();
  }, [loading, load]);

  if (loading)
    return (
      <PageShell>
        <p className="text-gray-300">Đang tải...</p>
      </PageShell>
    );

  const remove = async (id: string) => {
    const previous = entries;
    setEntries((current) => current.filter((entry) => entry.film.id !== id));
    try {
      // An account's history is on the server as well; a visitor's exists only here.
      if (user) await removeProgress(id);
      removeLocalProgress(id);
      setStoredFilms((count) => Math.max(0, count - 1));
    } catch (reason: unknown) {
      setEntries(previous);
      setError(accountErrorMessage(reason));
    }
  };

  const clearAll = async () => {
    if (!window.confirm("Xóa toàn bộ lịch sử xem? Việc này không thể hoàn tác.")) return;
    try {
      if (user) await clearProgress();
      clearLocalProgress();
      setEntries([]);
      setStoredFilms(0);
      toast.success("Đã xóa toàn bộ lịch sử xem.");
    } catch (reason: unknown) {
      setError(accountErrorMessage(reason));
    }
  };

  const hiddenFilms = storedFilms - entries.length;

  return (
    <PageShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-white text-2xl font-semibold">Xem tiếp</h1>
        {storedFilms > 0 && (
          <button
            type="button"
            onClick={() => void clearAll()}
            className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-xs text-gray-200 transition-colors hover:border-red-400 hover:text-red-400"
          >
            <i className="fa-solid fa-trash-can" aria-hidden="true" />
            Xóa tất cả lịch sử
          </button>
        )}
      </div>
      {!busy && hiddenFilms > 0 && (
        <p className="text-gray-400 text-sm mt-3">
          Còn {hiddenFilms} phim có lịch sử nhưng không hiện ở đây, vì tập gần nhất đã xem xong hoặc
          mới xem dưới 30 giây. Nút &quot;Xóa tất cả lịch sử&quot; xóa cả những phim đó.
        </p>
      )}
      {!user && (
        <p className="text-gray-400 text-sm mt-3">
          Danh sách này chỉ lưu trên trình duyệt này.{" "}
          <button
            type="button"
            onClick={() => openAuth("login")}
            className="text-primary underline"
          >
            Đăng nhập
          </button>{" "}
          để giữ nó trên mọi thiết bị.
        </p>
      )}
      {busy && <p className="text-gray-300 mt-8">Đang tải...</p>}
      {error && (
        <div className="mt-8 text-red-400">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} className="text-white underline mt-2">
            Thử lại
          </button>
        </div>
      )}
      {!busy && !error && entries.length === 0 && (
        <p className="text-gray-400 mt-8">Bạn chưa có phim đang xem.</p>
      )}
      <div className="space-y-4 mt-8">
        {entries.map((entry) => {
          const percent =
            entry.duration > 0
              ? Math.min(100, Math.max(0, (entry.position / entry.duration) * 100))
              : 0;
          return (
            <article
              key={`${entry.film.id}-${entry.episode.slug}`}
              className="flex items-center gap-4 rounded-xl bg-white/5 p-3"
            >
              <Image
                src={entry.film.banner || entry.film.poster}
                alt={entry.film.title}
                width={260}
                height={146}
                className="w-40 sm:w-56 aspect-video object-cover rounded-lg"
              />
              <div className="min-w-0 flex-1">
                <h2 className="text-white text-sm sm:text-base font-medium truncate">
                  {entry.film.title}
                </h2>
                <p className="text-gray-400 text-xs mt-1">{entry.episode.name}</p>
                <span className="block h-1 bg-gray-700 rounded-full mt-4 overflow-hidden">
                  <span className="block h-full bg-primary" style={{ width: `${percent}%` }} />
                </span>
                <Link
                  href={paths.watch(entry.film.id, entry.episode.slug)}
                  className="inline-block text-primary text-xs mt-3"
                >
                  Xem tiếp
                </Link>
              </div>
              <button
                type="button"
                onClick={() => void remove(entry.film.id)}
                className="text-gray-300 hover:text-white p-2"
                aria-label={`Xóa ${entry.film.title} khỏi danh sách xem tiếp`}
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </article>
          );
        })}
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: ReactNode }): ReactElement {
  return <section className="max-w-6xl mx-auto px-5 py-16 min-h-[60vh]">{children}</section>;
}
