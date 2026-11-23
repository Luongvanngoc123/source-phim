import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode, ReactElement } from "react";
import { toast } from "react-hot-toast";
import AuthContext from "@/context/AuthContext";
import Auth from "@/sections/auth";
import {
  AccountError,
  accountErrorMessage,
  currentUser,
  logout as logoutAccount,
} from "@/lib/account";
import type { User } from "@/lib/account";
import { syncLocalProgress } from "@/lib/progress";

let initialUserRequest: Promise<User> | undefined;

function loadInitialUser(): Promise<User> {
  initialUserRequest ??= currentUser();
  return initialUserRequest;
}

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void loadInitialUser()
      .then((value) => {
        if (active) setUser(value);
      })
      .catch((error: unknown) => {
        if (active && (!(error instanceof AccountError) || error.status !== 401)) {
          setUser(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (user) void syncLocalProgress(user.id);
  }, [user]);

  const openAuth = useCallback((mode: "login" | "register" = "login") => {
    setAuthMode(mode);
    setAuthOpen(true);
  }, []);
  const closeAuth = useCallback(() => setAuthOpen(false), []);
  const logout = useCallback(async () => {
    try {
      await logoutAccount();
      setUser(null);
    } catch (error: unknown) {
      toast.error(accountErrorMessage(error));
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, openAuth, logout, setUser, closeAuth }),
    [user, loading, openAuth, logout, closeAuth],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <Auth isOpen={authOpen} mode={authMode} closeAuth={closeAuth} />
    </AuthContext.Provider>
  );
}

export default AuthProvider;
