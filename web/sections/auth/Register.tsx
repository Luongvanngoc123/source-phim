import { useForm } from "react-hook-form";
import type { ReactElement } from "react";
import { toast } from "react-hot-toast";
import { useAuth } from "@/context/AuthContext";
import { AccountError, accountErrorMessage, register as registerAccount } from "@/lib/account";

interface RegisterFields {
  username: string;
  display_name: string;
  password: string;
  password_confirmation: string;
}

interface RegisterProps {
  closeAuth: () => void;
  onLogin: () => void;
}

export default function RegisterForm({ closeAuth, onLogin }: RegisterProps): ReactElement {
  const { setUser } = useAuth();
  const {
    register: field,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFields>();
  const password = watch("password");

  const onSubmit = async (data: RegisterFields) => {
    try {
      const user = await registerAccount(data.username, data.password, data.display_name.trim());
      setUser(user);
      toast.success("Tạo tài khoản thành công.");
      closeAuth();
    } catch (error: unknown) {
      if (error instanceof AccountError && error.field === "username") {
        setError("username", { type: "server", message: accountErrorMessage(error) });
      } else if (error instanceof AccountError && error.field === "display_name") {
        setError("display_name", { type: "server", message: accountErrorMessage(error) });
      } else if (error instanceof AccountError && error.field === "password") {
        setError("password", { type: "server", message: accountErrorMessage(error) });
      } else {
        toast.error(accountErrorMessage(error));
      }
    }
  };

  return (
    <div>
      <div className="text-white text-lg font-medium">Tạo tài khoản mới</div>
      <div className="flex items-center space-x-2 text-gray-400 text-sm my-4">
        <span>Nếu bạn đã có tài khoản,</span>
        <button type="button" className="text-primary" onClick={onLogin}>
          đăng nhập
        </button>
      </div>
      <form onSubmit={handleSubmit(onSubmit)}>
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
            type="text"
            autoComplete="name"
            {...field("display_name", {
              required: "Tên hiển thị không được để trống",
              validate: (value) => value.trim().length > 0 || "Tên hiển thị không được để trống",
              maxLength: { value: 40, message: "Tên hiển thị không quá 40 ký tự" },
            })}
            className="text-white w-full border border-gray-700 rounded-md px-4 py-3 text-sm focus:outline-none focus:border-white bg-[#1E2545] placeholder:text-gray-500"
            placeholder="Tên hiển thị"
          />
          {errors.display_name && (
            <p className="text-red-500 text-xs mt-1">{errors.display_name.message}</p>
          )}
        </div>
        <div className="relative w-full mt-3">
          <input
            type="password"
            autoComplete="new-password"
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
        <div className="relative w-full mt-3">
          <input
            type="password"
            autoComplete="new-password"
            {...field("password_confirmation", {
              required: "Mật khẩu xác nhận không được để trống",
              validate: (value) => value === password || "Mật khẩu xác nhận không khớp",
            })}
            className="text-white w-full border border-gray-700 rounded-md px-4 py-3 text-sm focus:outline-none focus:border-white bg-[#1E2545] placeholder:text-gray-500"
            placeholder="Nhập lại mật khẩu"
          />
          {errors.password_confirmation && (
            <p className="text-red-500 text-xs mt-1">{errors.password_confirmation.message}</p>
          )}
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="bg-primary text-black w-full px-4 py-3 mt-7 rounded-lg text-sm font-semibold disabled:opacity-60"
        >
          {isSubmitting ? "Đang đăng ký..." : "Đăng ký"}
        </button>
      </form>
    </div>
  );
}
