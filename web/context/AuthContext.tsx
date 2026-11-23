import { createContext, useContext } from "react";
import type { User } from "@/lib/account";

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  openAuth(mode?: "login" | "register"): void;
  logout(): Promise<void>;
  setUser(user: User | null): void;
  closeAuth(): void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export default AuthContext;
