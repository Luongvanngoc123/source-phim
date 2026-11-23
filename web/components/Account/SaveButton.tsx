import type { FilmRef } from "@/lib/account";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { useAuth } from "@/context/AuthContext";
import { accountErrorMessage, getFavorites, removeFavorite, saveFavorite } from "@/lib/account";

interface SaveButtonProps {
  film: FilmRef;
  className?: string;
}

export default function SaveButton({ film, className }: SaveButtonProps): ReactElement {
  const { user, openAuth } = useAuth();
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    if (!user) {
      setSaved(false);
      return () => {
        active = false;
      };
    }
    void getFavorites()
      .then((items) => {
        if (active) setSaved(items.some((item) => item.film.id === film.id));
      })
      .catch(() => {
        if (active) setSaved(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id, film.id]);

  const toggle = async () => {
    if (!user) {
      openAuth("login");
      return;
    }
    if (pending) return;
    const next = !saved;
    setSaved(next);
    setPending(true);
    try {
      if (next) await saveFavorite(film);
      else await removeFavorite(film.id);
      toast.success(next ? "Đã lưu phim." : "Đã bỏ lưu phim.");
    } catch (error: unknown) {
      setSaved(!next);
      toast.error(accountErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={saved}
      aria-label={saved ? "Bỏ lưu phim" : "Lưu phim"}
      className={className}
      onClick={() => void toggle()}
    >
      <i className={saved ? "fa-solid fa-bookmark" : "fa-regular fa-bookmark"} />
      <span className="sr-only">{saved ? "Bỏ lưu" : "Lưu phim"}</span>
    </button>
  );
}
