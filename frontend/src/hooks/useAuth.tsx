import { createContext, useContext, useCallback, useState, useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { logout as apiLogout, exitImpersonation } from "../api/auth";
import { setAccessToken, triggerRefresh } from "../api/client";

interface AuthCtx {
  username: string;
  isAdmin: boolean;
  isImpersonating: boolean;
  loaded: boolean;
  updateAuth: (username: string, isAdmin: boolean) => void;
  logout: () => Promise<void>;
  stopImpersonating: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    triggerRefresh()
      .then((data) => {
        if (data) {
          setUsername(data.username);
          setIsAdmin(data.is_admin);
          setIsImpersonating(data.is_impersonating);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const updateAuth = useCallback((u: string, admin: boolean) => {
    setUsername(u);
    setIsAdmin(admin);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setAccessToken(null);
    setUsername("");
    setIsAdmin(false);
    setIsImpersonating(false);
    navigate("/login", { replace: true });
  }, [navigate]);

  const stopImpersonating = useCallback(async () => {
    const data = await exitImpersonation();
    setAccessToken(data.access_token);
    setUsername(data.username);
    setIsAdmin(data.is_admin);
    setIsImpersonating(false);
    navigate("/admin/users");
  }, [navigate]);

  return (
    <Ctx.Provider
      value={{ username, isAdmin, isImpersonating, loaded, updateAuth, logout, stopImpersonating }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
