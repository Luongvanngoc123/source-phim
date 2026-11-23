import { useEffect, useState } from "react";
import type { ReactNode, ReactElement } from "react";
import { useForm } from "react-hook-form";
import type { UseFormRegisterReturn } from "react-hook-form";
import { toast } from "react-hot-toast";
import { useAuth } from "@/context/AuthContext";
import { accountErrorMessage, changePassword, updateProfile } from "@/lib/account";

interface ProfileFields {
  display_name: string;
}

interface PasswordFields {
  current_password: string;
  new_password: string;
  confirmation: string;
}

export default function AccountPage(): ReactElement {
  const { user, loading, openAuth, setUser, logout } = useAuth();
  const [profileBusy, setProfileBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const profile = useForm<ProfileFields>({
    defaultValues: { display_name: user?.display_name ?? "" },
  });
  useEffect(() => {
    if (user) profile.reset({ display_name: user.display_name });
  }, [profile, user?.id]);
  const password = useForm<PasswordFields>();
  if (loading)
    return (
      <AccountShell>
        <p className="text-gray-300">Đang tải...</p>
      </AccountShell>
    );
  if (!user) {
    return (
      <AccountShell>
        <p className="text-gray-300">Đăng nhập để quản lý tài khoản của bạn.</p>
        <button
          type="button"
          onClick={() => openAuth("login")}
          className="bg-primary text-black px-5 py-3 rounded-lg text-sm font-semibold mt-5"
        >
          Đăng nhập
        </button>
      </AccountShell>
    );
  }

  const saveProfile = async (fields: ProfileFields) => {
    setProfileBusy(true);
    try {
      const nextUser = await updateProfile(fields.display_name.trim());
      setUser(nextUser);
      toast.success("Đã cập nhật tên hiển thị.");
    } catch (error: unknown) {
      toast.error(accountErrorMessage(error));
    } finally {
      setProfileBusy(false);
    }
  };

  const savePassword = async (fields: PasswordFields) => {
    setPasswordBusy(true);
    try {
      await changePassword(fields.current_password, fields.new_password);
      password.reset();
      toast.success("Đã đổi mật khẩu.");
    } catch (error: unknown) {
      toast.error(accountErrorMessage(error));
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <AccountShell>
      <h1 className="text-white text-2xl font-semibold">Tài khoản</h1>
      <p className="text-gray-400 text-sm mt-2">@{user.username}</p>
      <form onSubmit={profile.handleSubmit(saveProfile)} className="mt-8 max-w-xl">
        <label className="text-white text-sm" htmlFor="display_name">
          Tên hiển thị
        </label>
        <input
          id="display_name"
          type="text"
          autoComplete="name"
          {...profile.register("display_name", {
            required: "Tên hiển thị không được để trống",
            maxLength: { value: 40, message: "Tên hiển thị không quá 40 ký tự" },
          })}
          className="mt-2 text-white w-full border border-gray-700 rounded-md px-4 py-3 text-sm focus:outline-none focus:border-white bg-[#1E2545]"
        />
        {profile.formState.errors.display_name && (
          <p className="text-red-500 text-xs mt-1">
            {profile.formState.errors.display_name.message}
          </p>
        )}
        <button
          type="submit"
          disabled={profileBusy}
          className="bg-primary text-black px-5 py-3 rounded-lg text-sm font-semibold mt-4 disabled:opacity-60"
        >
          {profileBusy ? "Đang lưu..." : "Lưu thay đổi"}
        </button>
      </form>
      <form onSubmit={password.handleSubmit(savePassword)} className="mt-12 max-w-xl">
        <h2 className="text-white text-lg font-medium">Đổi mật khẩu</h2>
        <PasswordField
          id="current_password"
          label="Mật khẩu hiện tại"
          autoComplete="current-password"
          register={password.register("current_password", { required: "Nhập mật khẩu hiện tại" })}
          error={password.formState.errors.current_password?.message}
        />
        <PasswordField
          id="new_password"
          label="Mật khẩu mới"
          autoComplete="new-password"
          register={password.register("new_password", {
            required: "Nhập mật khẩu mới",
            minLength: { value: 8, message: "Mật khẩu có ít nhất 8 ký tự" },
            maxLength: { value: 128, message: "Mật khẩu không quá 128 ký tự" },
          })}
          error={password.formState.errors.new_password?.message}
        />
        <PasswordField
          id="confirmation"
          label="Nhập lại mật khẩu mới"
          autoComplete="new-password"
          register={password.register("confirmation", {
            required: "Nhập lại mật khẩu mới",
            validate: (value) =>
              value === password.watch("new_password") || "Mật khẩu xác nhận không khớp",
          })}
          error={password.formState.errors.confirmation?.message}
        />
        <button
          type="submit"
          disabled={passwordBusy}
          className="bg-primary text-black px-5 py-3 rounded-lg text-sm font-semibold mt-4 disabled:opacity-60"
        >
          {passwordBusy ? "Đang lưu..." : "Đổi mật khẩu"}
        </button>
      </form>
      <button
        type="button"
        onClick={() => void logout()}
        className="text-white hover:text-primary text-sm mt-12"
      >
        Đăng xuất
      </button>
    </AccountShell>
  );
}

function PasswordField({
  id,
  label,
  autoComplete,
  register,
  error,
}: {
  id: string;
  label: string;
  autoComplete: string;
  register: UseFormRegisterReturn;
  error?: string;
}): ReactElement {
  return (
    <label htmlFor={id} className="block mt-4 text-white text-sm">
      {label}
      <input
        id={id}
        type="password"
        autoComplete={autoComplete}
        {...register}
        className="mt-2 text-white w-full border border-gray-700 rounded-md px-4 py-3 text-sm focus:outline-none focus:border-white bg-[#1E2545]"
      />
      {error && <span className="block text-red-500 text-xs mt-1">{error}</span>}
    </label>
  );
}

function AccountShell({ children }: { children: ReactNode }): ReactElement {
  return <section className="max-w-6xl mx-auto px-5 py-16 min-h-[60vh]">{children}</section>;
}
