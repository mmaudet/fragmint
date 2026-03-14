import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { apiRequest, setToken } from '@/api/client';
import type { LoginResponse, User } from '@/api/types';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);

  const login = useCallback(async (username: string, password: string) => {
    const result = await apiRequest<LoginResponse>('POST', '/v1/auth/login', { username, password });
    setToken(result.token);
    setTokenState(result.token);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
