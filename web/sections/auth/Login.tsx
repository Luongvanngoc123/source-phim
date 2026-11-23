import { useForm } from "react-hook-form";
import type { ReactElement } from "react";
import { toast } from "react-hot-toast";
import { useAuth } from "@/context/AuthContext";
import { AccountError, accountErrorMessage, login } from "@/lib/account";

interface LoginFields {
  username: string;
  password: string;
}

interface LoginProps {
  closeAuth: () => void;
  onRegister: () => void;
}

export default function LoginForm({ closeAuth, onRegister }: LoginProps): ReactElement {
  const { setUser } = useAuth();
  const {
    register: field,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginFields>();

  const onSubmit = async (data: LoginFields) => {
    try {
      const user = await login(data.username, data.password);
      setUser(user);
      toast.success("Đăng nhập thành công.");
      closeAuth();
    } catch (error: unknown) {
      if (error instanceof AccountError && error.field === "username") {
        setError("username", { type: "server", message: accountErrorMessage(error) });
      } else if (error instanceof AccountError && error.field === "password") {
        setError("password", { type: "server", message: accountErrorMessage(error) });
      } else {
        toast.error(accountErrorMessage(error));
      }
    }
  };

  return (
    <div>
      <div className="text-white text-lg font-medium">Đăng nhập</div>
      <div className="flex items-center space-x-2 text-gray-400 text-sm my-4">
        <span>Nếu bạn chưa có tài khoản,</span>
        <button type="button" className="text-primary" onClick={onRegister}>
          đăng ký ngay
        </button>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="pt-3">
        <div className="relative w-full">
          <input
            type="text"
            autoComplete="username"
            {...field("username", {
              required: "Tên đăng nhập không được để trống",
              pattern: {
                value: /^[A-Za-z0-9_.-]{3,32}$/,
                message: "Tên đăng nhập gồm 3–32 ký tự hợp lệ",
              },
            })}
            className="text-white w-full border border-gray-700 rounded-md px-4 py-3 text-sm focus:outline-none focus:border-white bg-[#1E2545] placeholder:text-gray-500"
            placeholder="Tên đăng nhập"
          />
          {errors.username && (
            <p className="text-red-500 text-xs mt-1">{errors.username.message}</p>
          )}
        </div>
        <div className="relative w-full mt-3">
          <input
            type="password"
            autoComplete="current-password"
            {...field("password", {
              required: "Mật khẩu không được để trống",
              minLength: { value: 8, message: "Mật khẩu có ít nhất 8 ký tự" },
              maxLength: { value: 128, message: "Mật khẩu không quá 128 ký tự" },
            })}
            className="text-white w-full border border-gray-700 rounded-md px-4 py-3 text-sm focus:outline-none focus:border-white bg-[#1E2545] placeholder:text-gray-500"
            placeholder="Mật khẩu"
          />
          {errors.password && (
            <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>
          )}
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="bg-primary text-black w-full px-4 py-3 mt-7 rounded-lg text-sm font-semibold disabled:opacity-60"
        >
          {isSubmitting ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>
    </div>
  );
}
