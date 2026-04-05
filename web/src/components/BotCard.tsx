'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import type { BotLiveData } from '@/lib/store';
import { useRoleStore, useControlStore } from '@/lib/store';
import { getPersonalityColor, STATE_COLORS, STATE_LABELS, PERSONALITY_ICONS } from '@/lib/constants';

function HealthBar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-zinc-500 w-4 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
      <span className="text-[10px] text-zinc-500 w-6 text-right tabular-nums">{value}</span>
    </div>
  );
}

export function BotCard({ bot, index = 0 }: { bot: BotLiveData; index?: number }) {
  const accentColor = getPersonalityColor(bot.personality);
  const stateColor = STATE_COLORS[bot.state] ?? '#6B7280';
  const stateLabel = STATE_LABELS[bot.state] ?? bot.state;
  const isActive = !['IDLE', 'DISCONNECTED', 'SPAWNING'].includes(bot.state);
  const emoji = PERSONALITY_ICONS[bot.personality?.toLowerCase()] ?? '';

  const override = useRoleStore((s) => s.getOverrideForBot(bot.name));
  const blockedMission = useRoleStore((s) => s.getBlockedMissionForBot(bot.name));
  const selectedBotIds = useControlStore((s) => s.selectedBotIds);
  const toggleBotSelection = useControlStore((s) => s.toggleBotSelection);
  const isSelected = selectedBotIds.has(bot.name.toLowerCase());

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="relative"
    >
      {/* Selection checkbox overlay */}
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleBotSelection(bot.name); }}
        className={`absolute top-3 right-3 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-all duration-150 ${
          isSelected
            ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.4)]'
            : 'border-zinc-600 hover:border-zinc-400 bg-zinc-900/80'
        }`}
        title={isSelected ? `Deselect ${bot.name}` : `Select ${bot.name}`}
      >
        {isSelected && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>
      <Link
        href={`/bots/${bot.name}`}
        className={`group block bg-zinc-900/80 border rounded-xl hover:border-zinc-600/60 transition-all duration-200 overflow-hidden hover:shadow-lg hover:shadow-black/20 ${
          isSelected
            ? 'border-emerald-500/50 ring-1 ring-emerald-500/20'
            : 'border-zinc-800/60'
        }`}
      >
        {/* Accent gradient bar */}
        <div
          className="h-0.5 transition-all duration-300 group-hover:h-1"
          style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}80)` }}
        />

        <div className="p-4 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0"
                style={{ backgroundColor: `${accentColor}15` }}
              >
                {emoji}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-white truncate">{bot.name}</h3>
                <p className="text-[11px] text-zinc-500 capitalize">{bot.personality}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Override badge */}
              {override && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md uppercase tracking-wide"
                  style={{ color: '#F59E0B', backgroundColor: '#F59E0B12' }}
                  title={override.reason}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Override
                </span>
              )}
              {/* Blocked mission warning */}
              {blockedMission && (
                <span
                  className="inline-flex items-center text-[10px] font-medium px-1.5 py-1 rounded-md"
                  style={{ color: '#EF4444', backgroundColor: '#EF444412' }}
                  title={`Blocked: ${blockedMission.blockedReason}`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4m0 4h.01" />
                  </svg>
                </span>
              )}
              <span
                className="inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-md uppercase tracking-wide"
                style={{ color: stateColor, backgroundColor: `${stateColor}12` }}
              >
                {isActive && (
                  <span
                    className="w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ backgroundColor: stateColor }}
                  />
                )}
                {stateLabel}
              </span>
            </div>
          </div>

          {/* Health / Hunger */}
          <div className="space-y-1.5">
            <HealthBar label="HP" value={bot.health ?? 20} max={20} color="#EF4444" />
            <HealthBar label="FD" value={bot.food ?? 20} max={20} color="#F59E0B" />
          </div>

          {/* Footer: Position & Mode */}
          <div className="flex items-center justify-between text-[10px] pt-1 border-t border-zinc-800/40">
            <span className="text-zinc-500 font-mono tabular-nums">
              {bot.position
                ? `${Math.round(bot.position.x)}, ${Math.round(bot.position.y)}, ${Math.round(bot.position.z)}`
                : '---'}
            </span>
            <span
              className="uppercase font-mono font-medium px-1.5 py-0.5 rounded text-[9px]"
              style={{
                color: bot.mode === 'codegen' ? '#10B981' : '#F59E0B',
                backgroundColor: bot.mode === 'codegen' ? '#10B98110' : '#F59E0B10',
              }}
            >
              {bot.mode}
            </span>
          </div>

          {/* Mini inventory */}
          {bot.inventory && bot.inventory.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {bot.inventory.slice(0, 4).map((item, i) => (
                <span
                  key={i}
                  className="text-[10px] bg-zinc-800/80 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700/30"
                  title={`${item.name} x${item.count}`}
                >
                  {item.name.replace(/_/g, ' ')} x{item.count}
                </span>
              ))}
              {bot.inventory.length > 4 && (
                <span className="text-[10px] text-zinc-600 px-1">
                  +{bot.inventory.length - 4}
                </span>
              )}
            </div>
          )}
        </div>
      </Link>
    </motion.div>
  );
}
