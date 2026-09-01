import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const SessionContext = createContext(null);

/**
 * Holds the signed-in user plus the server's module/role config, so screens can
 * ask `modules.bulkUpload` instead of hard-coding which features exist.
 */
export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cfg, me] = await Promise.all([
        api.get('/config').catch(() => null),
        api.get('/auth/me').catch(() => null),
      ]);
      if (cancelled) return;
      setConfig(cfg);
      setUser(me?.user ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const value = useMemo(
    () => ({
      user,
      config,
      loading,
      modules: config?.modules ?? {},
      roles: config?.roles ?? {},
      async login(uid, password) {
        const { user: u, home } = await api.post('/auth/login', { uid, password });
        setUser(u);
        return home;
      },
      async logout() {
        await api.post('/auth/logout');
        setUser(null);
      },
      async refresh() {
        const me = await api.get('/auth/me').catch(() => null);
        setUser(me?.user ?? null);
      },
    }),
    [user, config, loading]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
