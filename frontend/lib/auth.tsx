"use client";
import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface User {
  id: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  /**
   * Token param is accepted for backwards compatibility with existing call
   * sites (LoginForm, SignupForm). It is intentionally NOT stored anywhere —
   * the backend issues an httpOnly cookie that authenticates subsequent
   * requests. Keeping the JWT in localStorage would defeat that protection
   * (any XSS could exfiltrate it).
   */
  login: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Cookie-only session check — relies on the httpOnly access_token cookie
  // set by the backend on login.
  useEffect(() => {
    fetch("/api/auth/session", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setUser(data.user);
      })
      .catch(() => { /* unauthenticated — leave user null */ })
      .finally(() => setIsLoading(false));
  }, []);

  // Token argument is ignored; backend has already set the httpOnly cookie.
  const login = (_token: string, usr: User) => {
    setUser(usr);
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {}
    setUser(null);
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
