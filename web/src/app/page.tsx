'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { useBotStore, useRoleStore, type BotLiveData } from '@/lib/store';
import { useControlStore } from '@/lib/controlStore';
import { useMissionStore } from '@/lib/missionStore';
import { api, type BotEvent, type CommandType, type RoleAssignmentRecord } from '@/lib/api';
import { EVENT_CONFIG, getPersonalityColor, STATE_COLORS, STATE_LABELS, PERSONALITY_ICONS } from '@/lib/constants';
import Link from 'next/link';

// ---------------------------------------------------------------------------
//  Dashboard Page
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  const bots = useBotStore((s) => s.botList);
  const players = useBotStore((s) => s.playerList);
  const activityFeed = useBotStore((s) => s.activityFeed);
  const connected = useBotStore((s) => s.connected);
  const world = useBotStore((s) => s.world);

  const selectedBotIds = useControlStore((s) => s.selectedBotIds);
  const clearSelection = useControlStore((s) => s.clearSelection);
  const commands = useControlStore((s) => s.commandHistory);
  const missions = useMissionStore((s) => s.missions);

  const roleAssignments = useRoleStore((s) => s.assignments);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());

  // --- Data fetching ---------------------------------------------------------
  useEffect(() => {
    // Activity feed
    api.getActivity(20).then((data) => {
      for (const event of data.events.reverse()) {
        useBotStore.getState().pushEvent(event);
      }
    }).catch(() => {});

  }, []);

  const roleMap = roleAssignments.reduce<Record<string, typeof roleAssignments[number]>>((map, assignment) => {
    map[assignment.botName.toLowerCase()] = assignment;
    return map;
  }, {});

  // --- Derived data ----------------------------------------------------------
  const botNames = new Set(bots.map((b) => b.name.toLowerCase()));
  const onlinePlayers = players.filter((p) => p.isOnline && !botNames.has(p.name.toLowerCase()));
  const onlineBots = bots.filter((b) => b.state !== 'DISCONNECTED');
  const offlineBots = bots.filter((b) => b.state === 'DISCONNECTED');
  const executingBots = bots.filter((b) => b.state === 'EXECUTING_TASK');

  const pendingCommands = commands.filter((c) => c.status === 'queued' || c.status === 'started');
  const failedCommands = commands.filter((c) => c.status === 'failed');
  const activeMissions = missions.filter((m) => m.status === 'running' || m.status === 'queued');
  const failedMissions = missions.filter((m) => m.status === 'failed');

  // Bots needing attention: disconnected or low health
  const troubledBots = bots.filter(
    (b) => b.state === 'DISCONNECTED' || (b.health !== undefined && b.health < 5),
  );

  // Build attention items
  type AlertItem = {
    key: string;
    icon: string;
    color: string;
    label: string;
    detail: string;
    action?: { label: string; onClick: () => void };
  };

  const alerts: AlertItem[] = [];

  for (const bot of troubledBots) {
    const k = `bot-${bot.name}`;
    if (dismissedAlerts.has(k)) continue;
    const isDisconnected = bot.state === 'DISCONNECTED';
    alerts.push({
      key: k,
      icon: isDisconnected ? '-' : '!',
      color: '#EF4444',
      label: bot.name,
      detail: isDisconnected ? 'Disconnected' : `Low health (${bot.health ?? 0} HP)`,
      action: isDisconnected
        ? {
            label: 'Reconnect',
            onClick: () => {
              api.createBot(bot.name, bot.personality, bot.mode).catch(() => {});
            },
          }
        : undefined,
    });
  }

  for (const m of failedMissions.slice(0, 5)) {
    const k = `mission-${m.id}`;
    if (dismissedAlerts.has(k)) continue;
    alerts.push({
      key: k,
      icon: 'X',
      color: '#F59E0B',
      label: m.title,
      detail: `Mission failed (${m.assigneeIds.join(', ')})`,
      action: {
        label: 'Dismiss',
        onClick: () => setDismissedAlerts((s) => new Set(s).add(k)),
      },
    });
  }

  for (const c of failedCommands.slice(0, 5)) {
    const k = `cmd-${c.id}`;
    if (dismissedAlerts.has(k)) continue;
    alerts.push({
      key: k,
      icon: '!',
      color: '#F59E0B',
      label: `${c.type} failed`,
      detail: c.error?.message ?? `Targets: ${c.targets.join(', ')}`,
      action: {
        label: 'Retry',
        onClick: () => {
          api.createCommand({
            type: c.type,
            targets: c.targets,
            scope: c.scope,
            priority: c.priority,
            source: 'dashboard',
            payload: c.payload,
          }).catch(() => {});
          setDismissedAlerts((s) => new Set(s).add(k));
        },
      },
    });
  }

  // --- Bulk actions ----------------------------------------------------------
  const dispatchBulk = useCallback(
    (type: CommandType) => {
      const targets = Array.from(selectedBotIds);
      if (targets.length === 0) return;
      api.createCommand({ type, targets, scope: 'selection', source: 'dashboard' }).catch(() => {});
    },
    [selectedBotIds],
  );

  // --- Pending commands per bot ----------------------------------------------
  const pendingPerBot = (botName: string) =>
    pendingCommands.filter((c) => c.targets?.includes(botName)).length;

  return (
    <div className="p-6 lg:p-8 space-y-8 max-w-[1400px]">
      {/* ===== Fleet Summary Header ===== */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3"
      >
        <StatCard label="Total Bots" value={bots.length} subtext={connected ? 'Live' : 'Disconnected'} color="#60A5FA" />
        <StatCard label="Online" value={onlineBots.length} subtext={`${offlineBots.length} offline`} color="#10B981" />
        <StatCard label="Executing" value={executingBots.length} subtext="tasks running" color="#8B5CF6" />
        <StatCard label="Pending Cmds" value={pendingCommands.length} subtext={`${failedCommands.length} failed`} color="#F59E0B" />
        <StatCard label="Active Missions" value={activeMissions.length} subtext={`${failedMissions.length} failed`} color="#0EA5E9" />
        <StatCard
          label="World"
          value={world?.timeOfDay ?? '---'}
          subtext={world ? `Day ${world.day ?? '?'} ${world.isRaining ? '(Rain)' : ''}` : '---'}
          color="#F59E0B"
          isText
        />
      </motion.div>

      {/* Quick Nav */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link
          href="/map"
          className="text-xs bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors border border-zinc-700/50"
        >
          Open Map
        </Link>
        <Link
          href="/manage"
          className="text-xs bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors border border-zinc-700/50"
        >
          Create Bot
        </Link>
        <Link
          href="/chat"
          className="text-xs bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors border border-zinc-700/50"
        >
          Open Chat
        </Link>
      </div>

      {/* ===== Attention Section ===== */}
      <AnimatePresence>
        {alerts.length > 0 && (
          <motion.section
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <h2 className="text-sm font-semibold text-amber-400/90 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Needs Attention ({alerts.length})
            </h2>
            <div className="bg-zinc-900/60 rounded-xl border border-amber-500/20 divide-y divide-zinc-800/40">
              {alerts.map((alert) => (
                <motion.div
                  key={alert.key}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  className="flex items-center gap-3 px-4 py-2.5 text-xs"
                >
                  <span
                    className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0"
                    style={{ color: alert.color, backgroundColor: `${alert.color}15` }}
                  >
                    {alert.icon}
                  </span>
                  <span className="text-zinc-300 font-medium shrink-0">{alert.label}</span>
                  <span className="text-zinc-500 truncate flex-1">{alert.detail}</span>
                  {alert.action && (
                    <button
                      onClick={alert.action.onClick}
                      className="shrink-0 text-[10px] font-medium px-2.5 py-1 rounded-md border transition-colors"
                      style={{
                        color: alert.color,
                        borderColor: `${alert.color}40`,
                        backgroundColor: `${alert.color}08`,
                      }}
                    >
                      {alert.action.label}
                    </button>
                  )}
                  <button
                    onClick={() => setDismissedAlerts((s) => new Set(s).add(alert.key))}
                    className="text-zinc-600 hover:text-zinc-400 text-[10px] shrink-0"
                    title="Dismiss"
                  >
                    &times;
                  </button>
                </motion.div>
              ))}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* ===== Quick Actions Bar (selection) ===== */}
      <AnimatePresence>
        {selectedBotIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-3 bg-zinc-900/80 border border-indigo-500/30 rounded-xl px-4 py-3"
          >
            <span className="text-xs text-indigo-400 font-medium">
              {selectedBotIds.size} selected
            </span>
            <div className="flex-1" />
            <BulkButton label="Stop All" color="#EF4444" onClick={() => dispatchBulk('stop_movement')} />
            <BulkButton label="Pause All" color="#F59E0B" onClick={() => dispatchBulk('pause_voyager')} />
            <BulkButton label="Resume All" color="#10B981" onClick={() => dispatchBulk('resume_voyager')} />
            <button
              onClick={clearSelection}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 ml-2"
            >
              Clear
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== Bot Grid ===== */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Bots ({bots.length})
          </h2>
          <Link href="/manage" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
            Manage All
          </Link>
        </div>

        {bots.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16 bg-zinc-900/50 rounded-xl border border-zinc-800/40"
          >
            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
              </svg>
            </div>
            <p className="text-sm text-zinc-500">No bots online</p>
            <p className="text-xs text-zinc-600 mt-1">
              <Link href="/manage" className="text-emerald-500 hover:text-emerald-400">Create a bot</Link> to get started
            </p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {bots.map((bot, i) => (
              <EnhancedBotCard
                key={bot.name}
                bot={bot}
                index={i}
                role={roleMap[bot.name.toLowerCase()]}
                pendingCount={pendingPerBot(bot.name)}
                isSelected={selectedBotIds.has(bot.name)}
                onToggleSelect={() => useControlStore.getState().toggleBotSelection(bot.name)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ===== Online Players ===== */}
      {onlinePlayers.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
            Online Players ({onlinePlayers.length})
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {onlinePlayers.map((player, i) => (
              <motion.div
                key={player.name}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
                className="bg-zinc-900/80 border border-zinc-800/60 rounded-lg p-3 flex items-center gap-2.5"
              >
                <Image
                  src={`https://mc-heads.net/avatar/${player.name}/24`}
                  alt={player.name}
                  unoptimized
                  width={24}
                  height={24}
                  className="w-6 h-6 rounded pixelated"
                  style={{ imageRendering: 'pixelated' }}
                />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-white truncate">{player.name}</p>
                  {player.position && (
                    <p className="text-[10px] text-zinc-500 font-mono tabular-nums">
                      {Math.round(player.position.x)}, {Math.round(player.position.z)}
                    </p>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* ===== Recent Activity ===== */}
      {activityFeed.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              Recent Activity
            </h2>
            <Link href="/activity" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              View All
            </Link>
          </div>
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/40 divide-y divide-zinc-800/40">
            {activityFeed.slice(0, 15).map((event, i) => (
              <ActivityEntry key={`${event.timestamp}-${i}`} event={event} index={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label, value, subtext, color, isText = false,
}: {
  label: string; value: string | number; subtext: string; color: string; isText?: boolean;
}) {
  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
      <p className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">{label}</p>
      <p
        className={`${isText ? 'text-lg' : 'text-2xl'} font-bold mt-1 capitalize`}
        style={{ color }}
      >
        {value}
      </p>
      <p className="text-[11px] text-zinc-600 mt-0.5 truncate">{subtext}</p>
    </div>
  );
}

function BulkButton({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-colors"
      style={{
        color,
        borderColor: `${color}40`,
        backgroundColor: `${color}10`,
      }}
    >
      {label}
    </button>
  );
}

/** Enhanced BotCard wrapper: adds selection checkbox, role badge, task indicator, pending count */

function EnhancedBotCard({
  bot,
  index,
  role,
  pendingCount,
  isSelected,
  onToggleSelect,
}: {
  bot: BotLiveData;
  index: number;
  role?: RoleAssignmentRecord;
  pendingCount: number;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const accentColor = getPersonalityColor(bot.personality);
  const stateColor = STATE_COLORS[bot.state] ?? '#6B7280';
  const stateLabel = STATE_LABELS[bot.state] ?? bot.state;
  const isActive = !['IDLE', 'DISCONNECTED', 'SPAWNING'].includes(bot.state);
  const emoji = PERSONALITY_ICONS[bot.personality?.toLowerCase()] ?? '';

  // Voyager state from extended BotDetailed (may not be on BotLiveData, accessed via type assertion)
  const voyager = (bot as BotLiveData & { voyager?: { currentTask?: string | null } }).voyager;
  const currentTask = voyager?.currentTask ?? null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="relative"
    >
      {/* Selection checkbox */}
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSelect(); }}
        className={`absolute top-3 right-3 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
          isSelected
            ? 'bg-indigo-500 border-indigo-500'
            : 'bg-zinc-800/60 border-zinc-600/60 hover:border-zinc-400/60'
        }`}
      >
        {isSelected && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>

      <Link
        href={`/bots/${bot.name}`}
        className={`group block bg-zinc-900/80 border rounded-xl hover:border-zinc-600/60 transition-all duration-200 overflow-hidden hover:shadow-lg hover:shadow-black/20 ${
          isSelected ? 'border-indigo-500/50' : 'border-zinc-800/60'
        }`}
      >
        {/* Accent gradient bar */}
        <div
          className="h-0.5 transition-all duration-300 group-hover:h-1"
          style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}80)` }}
        />

        <div className="p-4 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 pr-6">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0"
                style={{ backgroundColor: `${accentColor}15` }}
              >
                {emoji}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-white truncate">{bot.name}</h3>
                <div className="flex items-center gap-1.5">
                  <p className="text-[11px] text-zinc-500 capitalize">{bot.personality}</p>
                  {role && (
                    <span
                      className="text-[9px] font-medium uppercase px-1.5 py-0.5 rounded-full border"
                      style={{
                        color: accentColor,
                        borderColor: `${accentColor}40`,
                        backgroundColor: `${accentColor}10`,
                      }}
                    >
                      {role.role}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <span
              className="inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-md uppercase tracking-wide shrink-0"
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

          {/* Current task indicator */}
          {currentTask && (
            <div className="text-[10px] text-zinc-400 bg-zinc-800/60 rounded-md px-2.5 py-1.5 truncate border border-zinc-700/30">
              <span className="text-emerald-400 font-medium mr-1">Task:</span>
              {currentTask}
            </div>
          )}

          {/* Health / Hunger */}
          <div className="space-y-1.5">
            <HealthBar label="HP" value={bot.health ?? 20} max={20} color="#EF4444" />
            <HealthBar label="FD" value={bot.food ?? 20} max={20} color="#F59E0B" />
          </div>

          {/* Footer: Position, Mode, Pending */}
          <div className="flex items-center justify-between text-[10px] pt-1 border-t border-zinc-800/40">
            <span className="text-zinc-500 font-mono tabular-nums">
              {bot.position
                ? `${Math.round(bot.position.x)}, ${Math.round(bot.position.y)}, ${Math.round(bot.position.z)}`
                : '---'}
            </span>
            <div className="flex items-center gap-2">
              {pendingCount > 0 && (
                <span className="text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded text-[9px] font-mono">
                  {pendingCount} cmd{pendingCount > 1 ? 's' : ''}
                </span>
              )}
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

function ActivityEntry({ event, index }: { event: BotEvent; index: number }) {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const config = EVENT_CONFIG[event.type];
  const color = config?.color ?? '#6B7280';

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      className="flex items-center gap-3 px-4 py-2.5 text-xs"
    >
      <span className="text-zinc-600 font-mono shrink-0 w-16 tabular-nums">{time}</span>
      <span
        className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0"
        style={{ color, backgroundColor: `${color}15` }}
      >
        {config?.icon ?? '.'}
      </span>
      <span className="text-zinc-300 font-medium shrink-0">{event.botName}</span>
      <span className="text-zinc-500 truncate flex-1">{event.description}</span>
    </motion.div>
  );
}
