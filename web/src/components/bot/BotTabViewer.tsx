'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';

interface Props {
  botName: string;
}

/**
 * 3D POV for a bot, rendered in an iframe pointed at the worker's
 * prismarine-viewer HTTP server. The server lazy-mounts the viewer on the
 * first GET to /api/bots/:name/viewer-port, so opening this tab pays the
 * WebGL/three.js cost — closing it doesn't reclaim it, but the cost is
 * one-per-bot rather than one-per-fleet-member-at-boot.
 *
 * Lazy-mount on the frontend too: this component only fires the port fetch
 * when it mounts, which happens only when the user actually selects the
 * "View" tab. Other tabs never trigger the viewer to start.
 */
export function BotTabViewer({ botName }: Props) {
  const [port, setPort] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);

  const fetchPort = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getBotViewerPort(botName);
      if (res.port == null) {
        setPort(null);
        setError('3D viewer unavailable — bot may not be connected');
      } else {
        setPort(res.port);
      }
    } catch (err: any) {
      setPort(null);
      setError(err?.message ?? '3D viewer unavailable — bot may not be connected');
    } finally {
      setLoading(false);
    }
  }, [botName]);

  useEffect(() => {
    fetchPort();
  }, [fetchPort, reconnectKey]);

  const handleReconnect = () => {
    setReconnectKey((k) => k + 1);
  };

  // The iframe `src` derives from window.location.hostname so the dashboard
  // works behind any reverse-proxy / remote host setup — the viewer ports
  // (3100+) need to be reachable from the browser on the same hostname.
  const src = typeof window !== 'undefined' && port != null
    ? `http://${window.location.hostname}:${port}`
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          3D POV
        </h2>
        <button
          onClick={handleReconnect}
          disabled={loading}
          className="text-[10px] font-medium px-2 py-1 rounded border border-zinc-700/60 hover:bg-zinc-800/60 text-zinc-400 transition-colors disabled:opacity-50"
          title="Refetch viewer port"
        >
          {loading ? 'Loading…' : 'Reconnect'}
        </button>
      </div>

      {loading && !src && (
        <div className="w-full h-[600px] rounded-xl border border-zinc-800 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-xs text-zinc-500">Starting viewer…</p>
          </div>
        </div>
      )}

      {!loading && error && !src && (
        <div className="w-full h-[600px] rounded-xl border border-zinc-800 flex items-center justify-center bg-zinc-950/60">
          <div className="text-center max-w-md px-6">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2">
                <path d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              </svg>
            </div>
            <p className="text-sm text-zinc-300 mb-1">3D viewer unavailable</p>
            <p className="text-xs text-zinc-500">{error}</p>
            <button
              onClick={handleReconnect}
              className="mt-4 text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {src && (
        <iframe
          // Re-keying the iframe forces a hard reload when the user clicks
          // Reconnect — useful if the viewer process has restarted on its own
          // (e.g. bot died → respawned with the same slot/port).
          key={`${src}-${reconnectKey}`}
          src={src}
          className="w-full h-[600px] rounded-xl border border-zinc-800"
          title={`${botName} POV`}
        />
      )}
    </motion.div>
  );
}
