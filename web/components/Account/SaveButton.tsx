import type { FilmRef } from "@/lib/account";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import clsx from "clsx";
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
      title={saved ? "Đã lưu. Bấm để bỏ lưu" : "Lưu phim"}
      className={clsx(
        "relative inline-flex items-center gap-2 rounded-full border px-5 py-3 transition-colors",
        // The two states differ in icon, colour, label and badge, so the state reads at a
        // glance and does not depend on colour alone.
        saved
          ? "border-primary bg-primary/15 text-primary hover:bg-primary/25"
          : "border-white/20 text-white hover:border-primary hover:text-primary",
        className,
      )}
      onClick={() => void toggle()}
    >
      <i className={saved ? "fa-solid fa-bookmark" : "fa-regular fa-bookmark"} aria-hidden="true" />
      <span className="text-sm font-medium">{saved ? "Đã lưu" : "Lưu phim"}</span>
      {saved && (
        <span
          className="absolute -right-1 -top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-primary text-[10px] text-black ring-2 ring-[#191b24]"
          aria-hidden="true"
        >
          <i className="fa-solid fa-check" />
        </span>
      )}
    </button>
  );
}
