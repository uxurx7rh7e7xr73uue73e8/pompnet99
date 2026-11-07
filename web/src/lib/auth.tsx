import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { get } from './api';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  emailVerified?: boolean;
  isPlatformOwner?: boolean;
  createdAt?: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug?: string;
  role?: string;
  plan?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  workspaces: Workspace[];
  workspaceId: string;
  workspace: Workspace | null;
  mailConfigured: boolean;
  loading: boolean;
  setWorkspaceId: (id: string) => void;
  refresh: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const WS_KEY = 'pn_workspace';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [mailConfigured, setMailConfigured] = useState(false);
  const [workspaceId, setWorkspaceIdState] = useState<string>(() => localStorage.getItem(WS_KEY) ?? '');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await get<{ user: AuthUser | null; workspaces: Workspace[]; mailConfigured?: boolean }>('/auth/me');
      setUser(data.user ?? null);
      setWorkspaces(data.workspaces ?? []);
      setMailConfigured(Boolean(data.mailConfigured));
      setWorkspaceIdState((current) => {
        const list = data.workspaces ?? [];
        if (current && list.some((w) => w.id === current)) return current;
        return list[0]?.id ?? '';
      });
    } catch {
      setUser(null);
      setWorkspaces([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (workspaceId) localStorage.setItem(WS_KEY, workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener('pn:unauthorized', onUnauthorized);
    return () => window.removeEventListener('pn:unauthorized', onUnauthorized);
  }, []);

  const setWorkspaceId = useCallback((id: string) => setWorkspaceIdState(id), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      workspaces,
      workspaceId,
      workspace: workspaces.find((w) => w.id === workspaceId) ?? null,
      mailConfigured,
      loading,
      setWorkspaceId,
      refresh,
      setUser,
    }),
    [user, workspaces, workspaceId, mailConfigured, loading, setWorkspaceId, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
