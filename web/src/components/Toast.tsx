'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

export type BannerSeverity = 'info' | 'warning' | 'error';

interface BannerItem {
  id: string;
  message: string;
  severity: BannerSeverity;
  dismissible: boolean;
}

interface ShowBannerOptions {
  dismissible: boolean;
  /** Stable id for de-duping / replacing the same banner (e.g. connection state). */
  id?: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastItem['type']) => void;
  showBanner: (message: string, severity: BannerSeverity, opts: ShowBannerOptions) => string;
  dismissBanner: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
  showBanner: () => '',
  dismissBanner: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;
let nextBannerCounter = 0;

const COLORS = {
  success: { bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.25)', text: '#10B981' },
  error: { bg: 'rgba(239, 68, 68, 0.12)', border: 'rgba(239, 68, 68, 0.25)', text: '#EF4444' },
  info: { bg: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.25)', text: '#3B82F6' },
  warning: { bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.25)', text: '#F59E0B' },
};

const BANNER_COLORS: Record<BannerSeverity, { bg: string; border: string; text: string }> = {
  info: { bg: 'rgba(59, 130, 246, 0.85)', border: 'rgba(59, 130, 246, 1)', text: '#FFFFFF' },
  warning: { bg: 'rgba(245, 158, 11, 0.9)', border: 'rgba(245, 158, 11, 1)', text: '#1F1500' },
  error: { bg: 'rgba(239, 68, 68, 0.9)', border: 'rgba(239, 68, 68, 1)', text: '#FFFFFF' },
};

const ICONS = {
  success: '✓',
  error: '✕',
  info: 'i',
  warning: '!',
};

// ── Imperative API ────────────────────────────────────────────────────────
// SocketProvider sits OUTSIDE ToastProvider in the layout tree, so it cannot
// consume the context via useToast(). Expose module-level functions backed by
// the active provider instance so any code (provider, util, etc.) can fire
// toasts/banners regardless of where it lives in the tree.

type ToastAPI = {
  toast: ToastContextValue['toast'];
  showBanner: ToastContextValue['showBanner'];
  dismissBanner: ToastContextValue['dismissBanner'];
};

let activeAPI: ToastAPI | null = null;

export function toast(message: string, type: ToastItem['type'] = 'info'): void {
  activeAPI?.toast(message, type);
}

export function showBanner(
  message: string,
  severity: BannerSeverity,
  opts: ShowBannerOptions,
): string {
  return activeAPI?.showBanner(message, severity, opts) ?? '';
}

export function dismissBanner(id: string): void {
  activeAPI?.dismissBanner(id);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [banners, setBanners] = useState<BannerItem[]>([]);

  const toastFn = useCallback((message: string, type: ToastItem['type'] = 'info') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const showBannerFn = useCallback(
    (message: string, severity: BannerSeverity, opts: ShowBannerOptions) => {
      const id = opts.id ?? `banner-${nextBannerCounter++}`;
      setBanners((prev) => {
        // If a banner with this id already exists, replace it in place.
        const without = prev.filter((b) => b.id !== id);
        return [...without, { id, message, severity, dismissible: opts.dismissible }];
      });
      return id;
    },
    [],
  );

  const dismissBannerFn = useCallback((id: string) => {
    setBanners((prev) => prev.filter((b) => b.id !== id));
  }, []);

  // Register / unregister the imperative API.
  useEffect(() => {
    activeAPI = { toast: toastFn, showBanner: showBannerFn, dismissBanner: dismissBannerFn };
    return () => {
      if (activeAPI && activeAPI.toast === toastFn) activeAPI = null;
    };
  }, [toastFn, showBannerFn, dismissBannerFn]);

  return (
    <ToastContext value={{ toast: toastFn, showBanner: showBannerFn, dismissBanner: dismissBannerFn }}>
      {/* Sticky banner stack — full-width, fixed at top, above toasts. */}
      <div className="fixed top-0 left-0 right-0 z-[60] flex flex-col">
        <AnimatePresence initial={false}>
          {banners.map((b) => {
            const c = BANNER_COLORS[b.severity];
            return (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2 }}
                className="w-full px-4 py-2 flex items-center justify-between gap-3 border-b shadow-md"
                style={{ backgroundColor: c.bg, borderColor: c.border, color: c.text }}
              >
                <span className="text-sm font-medium flex-1 text-center">{b.message}</span>
                {b.dismissible && (
                  <button
                    type="button"
                    onClick={() => dismissBannerFn(b.id)}
                    className="text-sm leading-none w-6 h-6 rounded hover:bg-black/20 flex items-center justify-center shrink-0"
                    aria-label="Dismiss"
                    style={{ color: c.text }}
                  >
                    ×
                  </button>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {children}

      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => {
            const c = COLORS[t.type];
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: 40, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="pointer-events-auto px-4 py-2.5 rounded-lg border backdrop-blur-sm flex items-center gap-2.5 shadow-lg max-w-sm"
                style={{ backgroundColor: c.bg, borderColor: c.border }}
              >
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{ backgroundColor: `${c.text}20`, color: c.text }}
                >
                  {ICONS[t.type]}
                </span>
                <span className="text-xs text-zinc-200">{t.message}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext>
  );
}
