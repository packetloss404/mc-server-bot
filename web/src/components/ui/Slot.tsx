'use client';

export interface SlotProps {
  itemName?: string | null;
  count?: number;
  size?: number;
  tooltip?: string;
  selected?: boolean;
  /**
   * Optional accent color (hex) used to tint the slot background and border.
   * When set, the slot renders a flat tinted look instead of the bevelled
   * Minecraft style. Useful for category-coded inventory grids.
   */
  accentColor?: string;
  /**
   * Subtle background lift for empty slots (e.g. hotbar vs main inventory).
   * Only takes effect when no accentColor and no item is shown.
   */
  highlight?: boolean;
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

export function Slot({
  itemName,
  count,
  size,
  tooltip,
  selected = false,
  accentColor,
  highlight = false,
}: SlotProps) {
  const empty = isEmpty(itemName);
  const displayLabel = empty ? '' : formatLabel(itemName as string);
  const showCount = !empty && typeof count === 'number' && count > 1;

  // Flat accent-tinted style: a thin colored border with a barely-there fill.
  // Used by category-coded inventory grids where the user prefers a calmer
  // look over the chunky bevelled Minecraft slot.
  if (accentColor !== undefined) {
    const fill = empty ? (highlight ? '#1a1a1e' : '#141416') : `${accentColor}08`;
    const border = empty ? (highlight ? '#27272a' : '#1c1c1e') : `${accentColor}20`;
    // If size is unset, the slot fills its parent grid cell via aspect-square.
    const sizeStyle = typeof size === 'number' ? { width: size, height: size } : {};
    return (
      <div
        title={tooltip ?? (empty ? 'Empty' : displayLabel)}
        className="aspect-square rounded flex items-center justify-center relative group cursor-default overflow-hidden"
        style={{ backgroundColor: fill, border: `1px solid ${border}`, ...sizeStyle }}
      >
        {!empty && (
          <span className="text-[7px] text-zinc-400 text-center leading-tight truncate px-0.5">
            {displayLabel.split(' ').slice(-1)[0]}
          </span>
        )}
        {showCount && (
          <span className="absolute bottom-0 right-0.5 text-[7px] text-white font-bold">
            {count}
          </span>
        )}
      </div>
    );
  }

  // Default bevelled slot size when none is specified.
  const resolvedSize = size ?? 32;

  // Beveled border: top/left highlight, bottom/right shadow.
  // Use inset box-shadow to achieve the chunky Minecraft slot look while
  // keeping everything in Tailwind/CSS rather than inline style objects.
  const bevel = selected
    ? 'shadow-[inset_1px_1px_0_0_rgba(255,255,255,0.25),inset_-1px_-1px_0_0_rgba(0,0,0,0.55)] ring-2 ring-emerald-400/80'
    : 'shadow-[inset_1px_1px_0_0_rgba(255,255,255,0.18),inset_-1px_-1px_0_0_rgba(0,0,0,0.55)]';

  const bgClass = empty
    ? highlight
      ? 'bg-zinc-800/60'
      : 'bg-zinc-900/60'
    : 'bg-zinc-700';

  return (
    <div
      title={tooltip ?? (empty ? undefined : displayLabel)}
      className={`relative inline-flex items-center justify-center border border-zinc-950/80 ${bgClass} ${bevel} overflow-hidden select-none`}
      style={{ width: resolvedSize, height: resolvedSize }}
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
