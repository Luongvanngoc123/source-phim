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
    <div className="fixed inset-0 flex items-start justify-center z-50 overflow-auto pb-12">
      <button
        type="button"
        aria-label="Đóng"
        className="bg-gray-900 bg-opacity-55 fixed inset-0 cursor-default"
        onClick={closeAuth}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={activeMode === "login" ? "Đăng nhập" : "Đăng ký"}
        className="bg-[#1E2545] modal rounded-xl p-8 lg:p-14 lg:[padding-left:calc(360px+4rem)] z-10 ml-5 mr-5 mt-16 w-full max-w-[700px] lg:max-w-[800px] lg:before:content-[''] lg:before:absolute lg:before:top-0 lg:before:left-0 lg:before:bottom-0 lg:before:w-[360px] lg:before:bg-[url('/images/home-background.jpg')] lg:before:bg-cover lg:before:bg-[position:0_100%] lg:before:rounded-l-xl relative sm:min-w-[400px]"
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
  );
}
