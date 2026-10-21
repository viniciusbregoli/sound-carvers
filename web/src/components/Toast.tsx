import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, Check, X } from 'lucide-react';

type Toast = { id: number; kind: 'error' | 'info'; message: string; action?: { label: string; run: () => void } };
type ToastApi = {
  error: (message: string) => void;
  info: (message: string, action?: Toast['action']) => void;
};

const Ctx = createContext<ToastApi | null>(null);

export function useToast() {
  const api = useContext(Ctx);
  if (!api) throw new Error('useToast outside ToastProvider');
  return api;
}

/** The topmost open modal: everything outside it is inert, so toasts must render inside it. */
function topDialog() {
  const open = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
  return open.length ? open[open.length - 1] : null;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    const update = () => setHost(topDialog());
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'], childList: true });
    return () => observer.disconnect();
  }, []);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-2), { ...toast, id }]);
      // Errors and toasts with an action wait for the person; plain confirmations fade on their own.
      if (toast.kind === 'info' && !toast.action) window.setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({
      error: (message) => push({ kind: 'error', message }),
      info: (message, action) => push({ kind: 'info', message, action }),
    }),
    [push],
  );

  const stack = (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          {t.kind === 'error' ? <CircleAlert size={18} aria-hidden /> : <Check size={18} aria-hidden />}
          <span className="toast-message">{t.message}</span>
          {t.action && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="icon-btn icon-btn-sm" aria-label="Fechar aviso" onClick={() => dismiss(t.id)}>
            <X size={16} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {createPortal(stack, host ?? document.body)}
    </Ctx.Provider>
  );
}
