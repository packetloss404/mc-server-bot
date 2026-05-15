'use client';

export interface SlotProps {
  itemName?: string | null;
  count?: number;
  size?: number;
  tooltip?: string;
  selected?: boolean;
}

function isEmpty(itemName?: string | null): boolean {
  if (!itemName) return true;
  const n = itemName.toLowerCase();
  return n === 'air' || n === '';
}

function formatLabel(itemName: string): string {
  // Strip minecraft: prefix and underscores, keep it compact for small slots.
  return itemName.replace(/^minecraft:/, '').replace(/_/g, ' ');
}

export function Slot({ itemName, count, size = 32, tooltip, selected = false }: SlotProps) {
  const empty = isEmpty(itemName);
  const displayLabel = empty ? '' : formatLabel(itemName as string);
  const showCount = !empty && typeof count === 'number' && count > 1;

  // Beveled border: top/left highlight, bottom/right shadow.
  // Use inset box-shadow to achieve the chunky Minecraft slot look while
  // keeping everything in Tailwind/CSS rather than inline style objects.
  const bevel = selected
    ? 'shadow-[inset_1px_1px_0_0_rgba(255,255,255,0.25),inset_-1px_-1px_0_0_rgba(0,0,0,0.55)] ring-2 ring-emerald-400/80'
    : 'shadow-[inset_1px_1px_0_0_rgba(255,255,255,0.18),inset_-1px_-1px_0_0_rgba(0,0,0,0.55)]';

  const bgClass = empty ? 'bg-zinc-900/60' : 'bg-zinc-700';

  return (
    <div
      title={tooltip ?? (empty ? undefined : displayLabel)}
      className={`relative inline-flex items-center justify-center border border-zinc-950/80 ${bgClass} ${bevel} overflow-hidden select-none`}
      style={{ width: size, height: size }}
    >
      {!empty && (
        <span
          className="text-[8px] leading-tight text-zinc-200 text-center px-0.5 break-all line-clamp-2"
          style={{ wordBreak: 'break-word' }}
        >
          {displayLabel}
        </span>
      )}
      {showCount && (
        <span
          className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white leading-none tabular-nums"
          style={{
            textShadow:
              '1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000',
          }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

export default Slot;
