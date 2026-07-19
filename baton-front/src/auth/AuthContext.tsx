/**
 * Auth Context — Baton
 * Self-contained cookie-session auth. On mount it asks the backend whether
 * first-run setup is still pending (GET /api/auth/status, public) and, if not,
 * probes the session with GET /api/auth/me. The httpOnly `baton_session`
 * cookie rides every same-origin request automatically — no tokens in JS.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api, setUnauthorizedHandler } from '@/lib/api';

// Shape returned by GET /api/auth/me (and by login/setup/accept-invite).
export interface AuthUser {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
  role: string;
}

export interface AuthOrganization {
  id: string;
  name?: string;
  plan: string;
  features: string[];
  executionsUsed?: number;
  createdAt?: string;
}

interface MeResponse {
  user: AuthUser;
  organization: AuthOrganization;
}

interface AuthContextValue {
  /** True until the initial /status (+ /me) probe completes. */
  loading: boolean;
  /** True when no user exists yet — the app must show first-run setup. */
  needsSetup: boolean;
  /** Signed-in user, or null when unauthenticated. */
  user: AuthUser | null;
  organization: AuthOrganization | null;
  /** Re-fetch /status and /me — call after login/setup/accept-invite. */
  refresh: () => Promise<void>;
  /** POST /auth/logout and drop the in-memory session. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organization, setOrganization] = useState<AuthOrganization | null>(null);

  const refresh = useCallback(async () => {
    try {
      const status = await api.get<{ needsSetup: boolean }>('/auth/status');
      if (status.needsSetup) {
        setNeedsSetup(true);
        setUser(null);
        setOrganization(null);
        return;
      }
      setNeedsSetup(false);
      try {
        const me = await api.get<MeResponse>('/auth/me');
        setUser(me.user);
        setOrganization(me.organization ?? null);
      } catch {
        // No/expired session cookie — signed out.
        setUser(null);
        setOrganization(null);
      }
    } catch {
      // /status unreachable (backend down). Treat as signed out rather than
      // first-run so we never show the setup form against a live install.
      setNeedsSetup(false);
      setUser(null);
      setOrganization(null);
    }
  }, []);

  // Initial probe.
  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Any 401 outside /auth/* (session expired server-side) flips us to
  // signed-out, which routes the app back to /signin.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setOrganization(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Cookie clearing failed server-side — still drop the local session.
    }
    setUser(null);
    setOrganization(null);
  }, []);

  return (
    <AuthContext.Provider value={{ loading, needsSetup, user, organization, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
