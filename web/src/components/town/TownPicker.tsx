'use client';

import { useTownStore, type Town } from '@/lib/townStore';

/**
 * Dropdown for picking the active town. Renders nothing when there's
 * only one town — the calling page should show the single town's
 * name directly in that case (it's part of the status pill).
 */
export function TownPicker() {
  const towns = useTownStore((s) => s.towns);
  const activeTownId = useTownStore((s) => s.activeTownId);
  const selectTown = useTownStore((s) => s.selectTown);

  if (towns.length < 2) return null;

  return (
    <label className="flex items-center gap-2 text-xs text-zinc-400">
      <span className="font-medium uppercase tracking-wider">Town</span>
      <select
        value={activeTownId ?? ''}
        onChange={(e) => selectTown(e.target.value || null)}
        className="bg-zinc-900 border border-zinc-800 text-zinc-100 text-xs rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        {towns.map((t: Town) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}
