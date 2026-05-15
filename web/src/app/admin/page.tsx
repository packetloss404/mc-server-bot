'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PageHeader } from '@/components/PageHeader';
import { LogStream } from '@/components/admin/LogStream';
import { api, type AdminInfo } from '@/lib/api';
import { useBotStore } from '@/lib/store';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

type Toast = { kind: 'success' | 'error' | 'info'; message: string } | null;

export default function AdminPage() {
  const botCount = useBotStore((s) => s.botList.length);
  const [info, setInfo] = useState<AdminInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  const fetchInfo = useCallback(async () => {
    try {
      const data = await api.getAdminInfo();
      setInfo(data);
      setInfoError(null);
    } catch (e: any) {
      setInfoError(e?.message ?? 'Failed to load server info');
    }
  }, []);

  useEffect(() => {
    void fetchInfo();
    const id = setInterval(fetchInfo, 5000);
    return () => clearInterval(id);
  }, [fetchInfo]);

  // Auto-dismiss toast after 4s.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const handleBackup = useCallback(() => {
    setBusy('backup');
    try {
      const url = api.getBackupDownloadUrl();
      // Open in same tab — server sends Content-Disposition: attachment so the
      // browser will download rather than navigate.
      window.location.href = url;
      setToast({ kind: 'info', message: 'Backup download starting…' });
    } catch (e: any) {
      setToast({ kind: 'error', message: e?.message ?? 'Backup failed' });
    } finally {
      // Reset busy after a short delay so the button shows the spinner briefly.
      setTimeout(() => setBusy((b) => (b === 'backup' ? null : b)), 600);
    }
  }, []);

  const handleHeapSnapshot = useCallback(async () => {
    setBusy('heap');
    try {
      const res = await api.triggerHeapSnapshot();
      if (res.success) {
        setToast({ kind: 'success', message: `Heap snapshot written: ${res.filePath ?? 'unknown'}` });
      } else {
        setToast({ kind: 'error', message: res.error ?? 'Heap snapshot failed' });
      }
    } catch (e: any) {
      setToast({ kind: 'error', message: e?.message ?? 'Heap snapshot failed' });
    } finally {
      setBusy(null);
    }
  }, []);

  const handleRestart = useCallback(async () => {
    setBusy('restart');
    setConfirmRestart(false);
    try {
      await api.triggerRestart();
      setToast({
        kind: 'info',
        message: 'Restart accepted — the server will be unreachable for a few seconds.',
      });
    } catch (e: any) {
      // 202 Accepted may race with the socket closing; not necessarily a failure.
      setToast({ kind: 'info', message: 'Restart request sent (connection may have dropped).' });
    } finally {
      setTimeout(() => setBusy((b) => (b === 'restart' ? null : b)), 1500);
    }
  }, []);

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-[1600px] h-[calc(100vh-0px)] flex flex-col">
      <PageHeader title="Admin" subtitle="Operational controls — logs, backup, restart, diagnostics" />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 flex-1 min-h-0">
        {/* Log stream — takes most of the page */}
        <div className="min-h-[480px] lg:min-h-0 flex flex-col">
          <LogStream />
        </div>

        {/* Sidebar */}
        <aside className="flex flex-col gap-4 min-w-0">
          {/* Server info */}
          <section className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
              Server Info
            </h2>
            {infoError && (
              <p className="text-xs text-red-400 mb-2">{infoError}</p>
            )}
            <dl className="space-y-2 text-xs">
              <InfoRow label="Uptime" value={info ? formatUptime(info.uptimeSec) : '—'} />
              <InfoRow label="RSS" value={info ? formatBytes(info.memory.rss) : '—'} />
              <InfoRow label="Heap used" value={info ? formatBytes(info.memory.heapUsed) : '—'} />
              <InfoRow label="Heap total" value={info ? formatBytes(info.memory.heapTotal) : '—'} />
              <InfoRow label="Bots" value={String(botCount)} />
              <InfoRow label="PID" value={info ? String(info.pid) : '—'} />
              <InfoRow label="Node" value={info?.nodeVersion ?? '—'} />
            </dl>
          </section>

          {/* Actions */}
          <section className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4 space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">
              Actions
            </h2>

            <ActionButton
              label="Download backup"
              hint="tar.gz of data, skills, config.yml"
              onClick={handleBackup}
              busy={busy === 'backup'}
            />

            <ActionButton
              label="Heap snapshot"
              hint="Write .heapsnapshot to diagnostics/"
              onClick={handleHeapSnapshot}
              busy={busy === 'heap'}
            />

            <ActionButton
              label="Restart server"
              hint="Graceful flush then exit (supervisor respawns)"
              onClick={() => setConfirmRestart(true)}
              busy={busy === 'restart'}
              intent="danger"
            />

            <p className="text-[10px] text-zinc-600 pt-2 border-t border-zinc-800/40">
              Restore from backup is manual — extract the archive over the project root
              while the server is stopped.
            </p>
          </section>
        </aside>
      </div>

      {/* Restart confirmation modal */}
      <AnimatePresence>
        {confirmRestart && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setConfirmRestart(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm font-semibold text-white mb-2">Restart server?</h3>
              <p className="text-xs text-zinc-400 mb-5 leading-relaxed">
                This will flush persistent stores and exit the process. The server should
                respawn automatically if a supervisor (PM2/systemd) is configured. There
                will be a brief outage while it comes back up.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirmRestart(false)}
                  className="px-3 py-1.5 text-xs rounded-md bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/60 text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRestart}
                  className="px-3 py-1.5 text-xs rounded-md bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-300 font-semibold"
                >
                  Restart
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-6 right-6 px-4 py-2.5 rounded-lg border text-xs font-medium shadow-lg z-50 max-w-md ${
              toast.kind === 'success'
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
                : toast.kind === 'error'
                  ? 'bg-red-500/15 border-red-500/40 text-red-200'
                  : 'bg-zinc-800/95 border-zinc-700/60 text-zinc-200'
            }`}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-200 tabular-nums truncate" title={value}>
        {value}
      </dd>
    </div>
  );
}

interface ActionButtonProps {
  label: string;
  hint?: string;
  onClick: () => void;
  busy?: boolean;
  intent?: 'default' | 'danger';
}

function ActionButton({ label, hint, onClick, busy, intent = 'default' }: ActionButtonProps) {
  const colors =
    intent === 'danger'
      ? 'bg-red-500/10 hover:bg-red-500/20 border-red-500/30 text-red-200'
      : 'bg-zinc-800/60 hover:bg-zinc-700/60 border-zinc-700/60 text-zinc-100';
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`w-full text-left px-3 py-2.5 rounded-lg border text-xs transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${colors}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{label}</span>
        {busy && (
          <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
        )}
      </div>
      {hint && <p className="text-[10px] mt-0.5 opacity-70">{hint}</p>}
    </button>
  );
}
