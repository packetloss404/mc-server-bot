'use client';

import { STATE_COLORS } from '@/lib/constants';

type SemanticStatus = 'idle' | 'working' | 'paused' | 'failed' | 'dead' | 'spawning' | 'unknown';

export interface StatusBadgeProps {
  status: SemanticStatus | string;
  size?: 'xs' | 'sm' | 'md';
  showDot?: boolean;
  /**
   * Optional override label. When provided, this is rendered verbatim instead
   * of deriving from `status`. Useful when the caller has a display-name map
   * (e.g. STATE_LABELS["EXECUTING_TASK"] = "Working").
   */
  label?: string;
}

// Map semantic statuses to colors. For unrecognized statuses, fall back to
// the global STATE_COLORS map (uppercased key) and finally to zinc.
const SEMANTIC_COLORS: Record<SemanticStatus, string> = {
  idle: '#6B7280',
  working: '#10B981',
  paused: '#F59E0B',
  failed: '#EF4444',
  dead: '#EF4444',
  spawning: '#3B82F6',
  unknown: '#6B7280',
};

const PULSE_STATUSES: Set<string> = new Set(['working', 'spawning']);

function resolveColor(status: string): string {
  const lower = status.toLowerCase() as SemanticStatus;
  if (SEMANTIC_COLORS[lower]) return SEMANTIC_COLORS[lower];
  const upper = status.toUpperCase();
  if (STATE_COLORS[upper]) return STATE_COLORS[upper];
  return '#6B7280';
}

const SIZE_CLASSES: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'text-[9px] px-1.5 py-0.5 gap-1',
  sm: 'text-[10px] px-2 py-1 gap-1.5',
  md: 'text-[11px] px-2.5 py-1 gap-1.5',
};

const DOT_SIZES: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'w-1 h-1',
  sm: 'w-1.5 h-1.5',
  md: 'w-2 h-2',
};

export function StatusBadge({ status, size = 'sm', showDot = true, label }: StatusBadgeProps) {
  const color = resolveColor(status);
  const displayLabel = label ?? status.replace(/_/g, ' ');
  const shouldPulse = PULSE_STATUSES.has(status.toLowerCase());

  return (
    <span
      className={`inline-flex items-center font-medium rounded-md uppercase tracking-wide ${SIZE_CLASSES[size]}`}
      style={{ color, backgroundColor: `${color}1A` }}
    >
      {showDot && (
        <span
          className={`${DOT_SIZES[size]} rounded-full ${shouldPulse ? 'animate-pulse' : ''}`}
          style={{ backgroundColor: color }}
        />
      )}
      {displayLabel}
    </span>
  );
}

export default StatusBadge;
