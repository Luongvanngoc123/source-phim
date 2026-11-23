import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import Link from "next/link";
import clsx from "clsx";
import { useAuth } from "@/context/AuthContext";
import { paths } from "@/lib/paths";

export default function AccountButton(): ReactElement | null {
  const { user, loading, openAuth, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  if (loading) return null;
  if (!user) {
    return (
      <button
        type="button"
        className="text-white hover:text-primary text-[13px] whitespace-nowrap"
        onClick={() => openAuth("login")}
      >
        Đăng nhập
      </button>
    );
  }

  const initial = user.display_name.trim().charAt(0).toUpperCase() || "A";
  const handleLogout = async () => {
    setOpen(false);
    await logout();
  };

  return (
    <div className="relative z-50" ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-label="Mở menu tài khoản"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center space-x-2 focus:outline-none"
      >
        <span className="border-2 border-white hover:opacity-80 h-10 w-10 rounded-full bg-primary text-black inline-flex items-center justify-center font-semibold">
          {initial}
        </span>
        <i
          className={clsx(
            "fa-solid fa-caret-down text-white transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="absolute right-0 top-[3rem] lg:w-[13rem] w-max bg-body rounded-lg shadow-xl overflow-hidden animate-fade-in-up origin-top-right">
          <div className="p-4 border-b border-white/10">
            <span className="text-white text-xs font-medium">{user.display_name}</span>
            <p className="text-gray-300 text-xs mt-1">@{user.username}</p>
          </div>
          <ul className="flex flex-col py-2">
            <li>
              <Link
                href={paths.continueWatching}
                onClick={() => setOpen(false)}
                className="flex items-center px-4 py-3 text-white hover:bg-white/5 transition-colors space-x-4"
              >
                <i className="fa-solid fa-clock-rotate-left text-xs" />
                <span className="text-xs font-medium">Xem tiếp</span>
              </Link>
            </li>
            <li>
              <Link
                href={paths.saved}
                onClick={() => setOpen(false)}
                className="flex items-center px-4 py-3 text-white hover:bg-white/5 transition-colors space-x-4"
              >
                <i className="fa-solid fa-heart text-xs" />
                <span className="text-xs font-medium">Phim đã lưu</span>
              </Link>
            </li>
            <li>
              <Link
                href={paths.account}
                onClick={() => setOpen(false)}
                className="flex items-center px-4 py-3 text-white hover:bg-white/5 transition-colors space-x-4"
              >
                <i className="fa-solid fa-user text-xs" />
                <span className="text-xs font-medium">Tài khoản</span>
              </Link>
            </li>
          </ul>
          <div className="border-t border-white/10 p-2">
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="w-full flex items-center px-4 py-2 text-white hover:bg-white/5 rounded-lg transition-colors space-x-4"
            >
              <i className="fa-solid fa-right-from-bracket text-xs" />
              <span className="text-xs font-medium">Đăng xuất</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
