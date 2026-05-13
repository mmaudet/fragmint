import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { apiRequest, getToken, setToken } from '@/api/client';
import type { LoginResponse, User } from '@/api/types';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USER_STORAGE_KEY = 'fragmint.auth.user';

function readStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function writeStoredUser(user: User | null) {
  try {
    if (user) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    // localStorage unavailable — session won't survive reload
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialToken = getToken();
  const [user, setUser] = useState<User | null>(initialToken ? readStoredUser() : null);
  const [token, setTokenState] = useState<string | null>(initialToken);

  const login = useCallback(async (username: string, password: string) => {
    const result = await apiRequest<LoginResponse>('POST', '/v1/auth/login', {
      username,
      password,
    });
    setToken(result.token);
    setTokenState(result.token);
    setUser(result.user);
    writeStoredUser(result.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
    setUser(null);
    writeStoredUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
