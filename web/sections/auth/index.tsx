import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import LoginForm from "./Login";
import RegisterForm from "./Register";

interface AuthProps {
  isOpen: boolean;
  mode: "login" | "register";
  closeAuth: () => void;
}

export default function Auth({ isOpen, mode, closeAuth }: AuthProps): ReactElement | null {
  const [activeMode, setActiveMode] = useState(mode);

  useEffect(() => setActiveMode(mode), [mode]);
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAuth();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("overflow-y-hidden");
    };
  }, [isOpen, closeAuth]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto">
      <button
        type="button"
        aria-label="Đóng"
        className="fixed inset-0 cursor-default bg-black/60 backdrop-blur-[2px]"
        onClick={closeAuth}
      />
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={activeMode === "login" ? "Đăng nhập" : "Đăng ký"}
          className="relative z-10 w-full max-w-[420px] rounded-2xl bg-[#1E2545] p-7 shadow-2xl ring-1 ring-white/10 sm:p-9"
        >
          <button
            type="button"
            aria-label="Đóng"
            className="absolute top-0 right-0 text-white w-12 h-12 min-h-[40px] p-0 text-base font-medium inline-flex items-center justify-center gap-2 rounded-[0.4rem]"
            onClick={closeAuth}
          >
            <i className="fa-solid fa-times" />
          </button>
          {activeMode === "login" ? (
            <LoginForm closeAuth={closeAuth} onRegister={() => setActiveMode("register")} />
          ) : (
            <RegisterForm closeAuth={closeAuth} onLogin={() => setActiveMode("login")} />
          )}
        </div>
      </div>
    </div>
  );
}
