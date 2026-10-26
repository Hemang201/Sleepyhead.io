import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { api, ApiError, type AdminSession } from './api';
import type { SecurityState } from '../shared/owner-security';

/**
 * Dashboard-wide state: who is signed in and the toast queue.
 *
 * Nothing here decides access — it only reflects what the server said. Every
 * admin request is authorized again on the Worker.
 */

interface Toast {
  id: string;
  tone: 'ok' | 'warn' | 'error';
  title: string;
  body?: string;
}

interface AdminValue {
  session: AdminSession | null;
  /**
   * The second factor as the server reports it. `null` while loading or when
   * nobody is signed in. Nothing here is trusted for access decisions — every
   * admin request is authorized again on the Worker.
   */
  security: SecurityState | null;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  reload: () => void;
  toasts: Toast[];
  notify: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
}

const AdminContext = createContext<AdminValue | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<number[]>([]);

  const load = useCallback(async () => {
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    try {
      const data = await api.admin.session();
      setSession(data);
      setError(null);
      setStatus('ready');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The dashboard could not reach the server.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const dismiss = useCallback((id: string) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

  const notify = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current.slice(-3), { ...toast, id }]);
      const timer = window.setTimeout(() => dismiss(id), toast.tone === 'error' ? 9000 : 5000);
      timers.current.push(timer);
    },
    [dismiss],
  );

  const value = useMemo<AdminValue>(
    () => ({
      session,
      security: session?.security ?? null,
      status,
      error,
      reload: () => void load(),
      toasts,
      notify,
      dismiss,
    }),
    [dismiss, error, load, notify, session, status, toasts],
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminValue {
  const value = useContext(AdminContext);
  if (!value) throw new Error('useAdmin must be used inside an AdminProvider');
  return value;
}

/**
 * Convenience wrapper: run an admin action and report the outcome as a toast.
 *
 * A second call while one is in flight is refused rather than queued. The
 * buttons disable themselves while busy, but a double click lands both events
 * before React has re-rendered, and that produced duplicate PATCH requests,
 * duplicate build rows and duplicate uploads. The guard is a ref so it is
 * decided at call time, not at render time.
 */
export function useAdminAction(): {
  run: <T>(action: () => Promise<T>, messages: { ok: string; okBody?: string; failure?: string }) => Promise<T | null>;
  busy: boolean;
} {
  const { notify } = useAdmin();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const run = useCallback(
    async <T,>(
      action: () => Promise<T>,
      messages: { ok: string; okBody?: string; failure?: string },
    ): Promise<T | null> => {
      if (running.current) return null;
      running.current = true;
      setBusy(true);
      try {
        const result = await action();
        notify({ tone: 'ok', title: messages.ok, body: messages.okBody });
        return result;
      } catch (caught) {
        const detail =
          caught instanceof ApiError && caught.fields
            ? Object.values(caught.fields).join(' ')
            : caught instanceof Error
              ? caught.message
              : 'Unknown error.';
        notify({ tone: 'error', title: messages.failure ?? 'That did not work', body: detail });
        return null;
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [notify],
  );

  return { run, busy };
}

export function ToastViewport() {
  const { toasts, dismiss } = useAdmin();
  if (toasts.length === 0) return null;

  return (
    <div className="toast-viewport" role="region" aria-label="Notifications">
      {toasts.map((toast) => (
        <div className={`toast toast--${toast.tone}`} key={toast.id} role={toast.tone === 'error' ? 'alert' : 'status'}>
          <div>
            <p className="toast__title">{toast.title}</p>
            {toast.body ? <p className="toast__body">{toast.body}</p> : null}
          </div>
          <button type="button" className="toast__close" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
