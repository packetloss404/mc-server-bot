'use client';

import { motion } from 'framer-motion';

export type ProgressBarIntent = 'default' | 'success' | 'warning' | 'danger';
export type ProgressBarHeight = 'xs' | 'sm' | 'md';

export interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  showPercent?: boolean;
  intent?: ProgressBarIntent;
  height?: ProgressBarHeight;
  /**
   * Optional explicit fill color (hex). Overrides `intent` when set. Use this
   * for callers that pick a color from a score-bucket helper rather than from
   * the four semantic intents.
   */
  color?: string;
}

const INTENT_COLORS: Record<ProgressBarIntent, string> = {
  default: '#1ABC9C',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
};

const HEIGHT_CLASSES: Record<ProgressBarHeight, string> = {
  xs: 'h-1',
  sm: 'h-1.5',
  md: 'h-2',
};

export function ProgressBar({
  value,
  max = 1,
  label,
  showPercent = false,
  intent = 'default',
  height = 'sm',
  color: colorOverride,
}: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.max(0, Math.min(1, value / safeMax));
  const pct = ratio * 100;
  const color = colorOverride ?? INTENT_COLORS[intent];

  return (
    <div className="w-full space-y-1">
      {(label || showPercent) && (
        <div className="flex items-center justify-between text-[10px]">
          {label ? (
            <span className="text-zinc-400 truncate">{label}</span>
          ) : (
            <span />
          )}
          {showPercent && (
            <span className="text-zinc-500 tabular-nums">{Math.round(pct)}%</span>
          )}
        </div>
      )}
      <div className={`w-full ${HEIGHT_CLASSES[height]} bg-zinc-800 rounded-full overflow-hidden`}>
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

export default ProgressBar;
