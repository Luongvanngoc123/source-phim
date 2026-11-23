import { useCallback, useEffect, useState } from "react";
import type { ReactNode, ReactElement } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { accountErrorMessage, getFavorites, removeFavorite } from "@/lib/account";
import type { FilmRef } from "@/lib/account";
import { paths } from "@/lib/paths";

interface SavedFilm {
  film: FilmRef;
  saved_at: number;
}

export default function SavedFilmsPage(): ReactElement {
  const { user, loading, openAuth } = useAuth();
  const [items, setItems] = useState<SavedFilm[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setItems(await getFavorites());
    } catch (reason: unknown) {
      setError(accountErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
    else {
      setItems([]);
      setBusy(false);
    }
  }, [user?.id, load]);

  if (loading)
    return (
      <AccountPageShell>
        <p className="text-gray-300">Đang tải...</p>
      </AccountPageShell>
    );
  if (!user) {
    return (
      <AccountPageShell>
        <p className="text-gray-300">Đăng nhập để xem những phim bạn đã lưu.</p>
        <button
          type="button"
          onClick={() => openAuth("login")}
          className="bg-primary text-black px-5 py-3 rounded-lg text-sm font-semibold mt-5"
        >
          Đăng nhập
        </button>
      </AccountPageShell>
    );
  }

  const remove = async (film: FilmRef) => {
    const previous = items;
    setItems((current) => current.filter((item) => item.film.id !== film.id));
    try {
      await removeFavorite(film.id);
    } catch (reason: unknown) {
      setItems(previous);
      setError(accountErrorMessage(reason));
    }
  };

  return (
    <AccountPageShell>
      <h1 className="text-white text-2xl font-semibold">Phim đã lưu</h1>
      {busy && <p className="text-gray-300 mt-8">Đang tải...</p>}
      {error && (
        <div className="mt-8 text-red-400">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} className="text-white underline mt-2">
            Thử lại
          </button>
        </div>
      )}
      {!busy && !error && items.length === 0 && (
        <p className="text-gray-400 mt-8">Bạn chưa lưu phim nào.</p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5 mt-8">
        {items.map(({ film }) => (
          <article key={film.id} className="relative group">
            <Link href={paths.film(film.id)} className="block">
              <Image
                src={film.poster}
                alt={film.title}
                width={300}
                height={450}
                className="rounded-xl w-full aspect-[2/3] object-cover"
              />
              <h2 className="text-white text-sm font-medium truncate mt-2">{film.title}</h2>
            </Link>
            <button
              type="button"
              onClick={() => void remove(film)}
              aria-label={`Bỏ lưu ${film.title}`}
              className="absolute top-2 right-2 bg-black/75 text-white rounded-full w-8 h-8 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </article>
        ))}
      </div>
    </AccountPageShell>
  );
}

function AccountPageShell({ children }: { children: ReactNode }): ReactElement {
  return <section className="max-w-6xl mx-auto px-5 py-16 min-h-[60vh]">{children}</section>;
}
