import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, getToken, setToken } from "./api";
import { FullPageLoader } from "./components/ui";
import type { User } from "./types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function homeForRole(user: User | null): string {
  if (!user) return "/login";
  if (user.role === "employee") return "/staff";
  if (user.role === "admin") return "/admin/users";
  return "/app";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function restore() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.auth.me();
        if (active) setUser(me);
      } catch {
        setToken(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    restore();
    const onExpired = () => {
      setToken(null);
      setUser(null);
    };
    window.addEventListener("creditpath:auth-expired", onExpired);
    return () => {
      active = false;
      window.removeEventListener("creditpath:auth-expired", onExpired);
    };
  }, []);

  async function login(username: string, password: string) {
    const response = await api.auth.login(username, password);
    setToken(response.access_token);
    setUser(response.user);
    return response.user;
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  async function refresh() {
    const me = await api.auth.me();
    setUser(me);
  }

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth должен использоваться внутри AuthProvider");
  return context;
}

export function RequireRole({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoader label="Проверяем сессию…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!roles.includes(user.role)) return <Navigate to={homeForRole(user)} replace />;
  return <>{children}</>;
}
