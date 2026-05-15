'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';

interface Props {
  townId: string;
}

const POLL_MS = 10_000;

// Keep this in lockstep with RoleBreakdownCard's roster — these are the
// roles the user can select in the dropdown. Any extra role values that come
// back from the API (e.g. legacy roles) are still accepted as the current
// value, they just don't appear in the dropdown choices.
const ROLE_OPTIONS: string[] = [
  'lumberjack',
  'miner',
  'farmer',
  'blacksmith',
  'builder',
  'guard',
  'gatherer',
  'idle',
];

interface ResidentRow {
  botName: string;
  role: string;
}

/**
 * Table of residents with a per-row role dropdown. Selecting a new role
 * POSTs to /api/towns/:id/roles/:botName, optimistically updates the row,
 * and reverts (with a toast) if the request fails.
 */
export function RoleResidentList({ townId }: Props) {
  const { toast } = useToast();
  const [residents, setResidents] = useState<ResidentRow[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** Bot names currently in flight — used to show a "saving…" indicator. */
  const [saving, setSaving] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const res = await api.listTownRoles(townId);
      if (cancelled) return;
      setResidents(res?.residents ?? null);
      setLoaded(true);
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [townId]);

  const handleRoleChange = async (botName: string, nextRole: string) => {
    if (!residents) return;
    const prevRole = residents.find((r) => r.botName === botName)?.role;
    if (prevRole === nextRole) return;

    // Optimistic update.
    setResidents((curr) =>
      curr ? curr.map((r) => (r.botName === botName ? { ...r, role: nextRole } : r)) : curr,
    );
    setSaving((curr) => {
      const next = new Set(curr);
      next.add(botName);
      return next;
    });

    try {
      await api.setResidentRole(townId, botName, nextRole);
      toast(`${botName} is now a ${nextRole}`, 'success');
    } catch (err: unknown) {
      // Revert.
      setResidents((curr) =>
        curr
          ? curr.map((r) => (r.botName === botName ? { ...r, role: prevRole ?? r.role } : r))
          : curr,
      );
      const msg = err instanceof Error ? err.message : 'Failed to update role';
      toast(msg, 'error');
    } finally {
      setSaving((curr) => {
        const next = new Set(curr);
        next.delete(botName);
        return next;
      });
    }
  };

  return (
    <section className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">Residents</h3>
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Reassign roles</span>
      </header>

      {!loaded ? (
        <div className="px-4 py-10 text-center text-xs text-zinc-500">Loading residents…</div>
      ) : !residents || residents.length === 0 ? (
        <div className="px-4 py-10 text-center text-xs text-zinc-500">
          No role data yet. Add residents to this town to assign roles.
        </div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto divide-y divide-zinc-800/60">
          <div className="grid grid-cols-[1fr_minmax(160px,auto)_64px] px-4 py-2 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold bg-zinc-950/40">
            <span>Bot</span>
            <span>Role</span>
            <span className="text-right">Status</span>
          </div>
          {residents.map((r) => {
            const isSaving = saving.has(r.botName);
            // If the bot's current role isn't in the canonical list, include
            // it so we don't accidentally drop it.
            const options = ROLE_OPTIONS.includes(r.role)
              ? ROLE_OPTIONS
              : [...ROLE_OPTIONS, r.role];
            return (
              <div
                key={r.botName}
                className="grid grid-cols-[1fr_minmax(160px,auto)_64px] items-center px-4 py-2 gap-3 hover:bg-zinc-800/30 transition-colors"
              >
                <span className="text-xs font-semibold text-zinc-200 truncate" title={r.botName}>
                  {r.botName}
                </span>
                <select
                  value={r.role}
                  disabled={isSaving}
                  onChange={(e) => handleRoleChange(r.botName, e.target.value)}
                  className="text-xs bg-zinc-950/80 border border-zinc-800 hover:border-amber-500/40 focus:border-amber-500/60 focus:outline-none rounded-md px-2 py-1 text-zinc-200 disabled:opacity-60 disabled:cursor-wait capitalize"
                >
                  {options.map((opt) => (
                    <option key={opt} value={opt} className="capitalize bg-zinc-900">
                      {opt}
                    </option>
                  ))}
                </select>
                <span className="text-right text-[10px] text-amber-400/80 tabular-nums">
                  {isSaving ? 'saving…' : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default RoleResidentList;
