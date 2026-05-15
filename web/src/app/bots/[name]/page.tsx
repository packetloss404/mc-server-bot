'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { api, type BotDetailed } from '@/lib/api';
import {
  getPersonalityColor,
  STATE_LABELS,
  PERSONALITY_ICONS,
} from '@/lib/constants';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { StatCard as SharedStatCard } from '@/components/ui/StatCard';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { BotTabOverview } from '@/components/bot/BotTabOverview';
import { BotTabConsole } from '@/components/bot/BotTabConsole';
import { BotTabTasks } from '@/components/bot/BotTabTasks';
import { BotTabInventory } from '@/components/bot/BotTabInventory';
import { BotTabRelationships } from '@/components/bot/BotTabRelationships';
import { BotTabReputation } from '@/components/bot/BotTabReputation';
import { DecisionTimeline } from '@/components/bot/DecisionTimeline';
import { MessagingPanel } from '@/components/bot/MessagingPanel';
import { SocialMemoryPanel } from '@/components/bot/SocialMemoryPanel';

type TabId =
  | 'overview' | 'console' | 'tasks' | 'inventory' | 'relationships' | 'reputation'
  | 'decisions' | 'messages' | 'memory';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'console', label: 'Console' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'relationships', label: 'Relationships' },
  { id: 'reputation', label: 'Reputation' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'messages', label: 'Messages' },
  { id: 'memory', label: 'Memory' },
];

function isTabId(s: string | null): s is TabId {
  return (
    s === 'overview' || s === 'console' || s === 'tasks' || s === 'inventory'
    || s === 'relationships' || s === 'reputation' || s === 'decisions'
    || s === 'messages' || s === 'memory'
  );
}

export default function BotProfilePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const name = params.name as string;

  const [bot, setBot] = useState<BotDetailed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modeBusy, setModeBusy] = useState(false);

  const tabParam = searchParams.get('tab');
  const activeTab: TabId = isTabId(tabParam) ? tabParam : 'overview';

  const setActiveTab = useCallback(
    (tab: TabId) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === 'overview') {
        params.delete('tab');
      } else {
        params.set('tab', tab);
      }
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [router, searchParams],
  );

  useEffect(() => {
    const load = () => {
      api
        .getBotDetailed(name)
        .then((data) => {
          setBot(data.bot);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    };
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [name]);

  const handleToggleMode = async () => {
    if (!bot || modeBusy) return;
    setModeBusy(true);
    const next = bot.mode === 'codegen' ? 'primitive' : 'codegen';
    try {
      await api.setMode(name, next);
      setBot({ ...bot, mode: next });
    } catch {
      /* ignore */
    }
    setModeBusy(false);
  };

  const handleTogglePause = async () => {
    if (!bot || modeBusy) return;
    setModeBusy(true);
    try {
      if (bot.voyager?.isPaused) {
        await api.resumeBot(name);
      } else {
        await api.pauseBot(name);
      }
    } catch {
      /* ignore */
    }
    setModeBusy(false);
  };

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <p className="text-red-400 text-sm">{error}</p>
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300 mt-3 inline-block">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  if (!bot) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-zinc-500">Loading {name}...</p>
        </div>
      </div>
    );
  }

  const accentColor = getPersonalityColor(bot.personality);
  const emoji = PERSONALITY_ICONS[bot.personality?.toLowerCase()] ?? '';
  const isPaused = bot.voyager?.isPaused ?? false;
  const stateLabel = STATE_LABELS[bot.state] ?? bot.state;
  const positionValue = bot.position
    ? `${Math.round(bot.position.x)}, ${Math.round(bot.position.y)}, ${Math.round(bot.position.z)}`
    : 'Unknown';
  const currentTaskValue = bot.voyager?.currentTask ?? 'Idle';
  const queuedHint = bot.voyager?.queuedTaskCount
    ? `+${bot.voyager.queuedTaskCount} queued`
    : undefined;

  return (
    <div className="max-w-7xl">
      {/* ═══ STICKY HEADER ═══ */}
      <div className="sticky top-0 z-30 bg-zinc-950/85 backdrop-blur-md border-b border-zinc-800/60">
        <div className="p-6 lg:p-8 pb-0 space-y-4">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-xs text-zinc-600">
            <Link href="/" className="hover:text-zinc-300 transition-colors">
              Dashboard
            </Link>
            <span>/</span>
            <span className="text-zinc-400">{bot.name}</span>
          </div>

          {/* Title row */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="w-1 h-10 rounded-full"
                style={{ background: `linear-gradient(180deg, ${accentColor}, ${accentColor}40)` }}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">{emoji}</span>
                  <h1 className="text-xl font-bold text-white truncate">{bot.name}</h1>
                </div>
                <p className="text-xs truncate" style={{ color: accentColor }}>
                  {bot.personalityDisplayName}
                </p>
              </div>
            </div>
            <StatusBadge status={bot.state} size="sm" showDot label={stateLabel} />
          </div>

          {/* Four stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Vitals — keeps the local children-style container because the
                shared StatCard takes a single string/number `value` and can't
                host two bars. */}
            <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg p-2.5">
              <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1.5 font-semibold">Vitals</p>
              <div className="space-y-1">
                <VitalBar label="HP" value={bot.health} max={20} intent="danger" />
                <VitalBar label="FD" value={bot.food} max={20} intent="warning" />
              </div>
            </div>

            {/* Position */}
            <SharedStatCard label="Position" value={positionValue} hint="overworld" />

            {/* Current Task */}
            <SharedStatCard
              label="Current Task"
              value={currentTaskValue}
              hint={queuedHint}
            />

            {/* Mode + Pause/Resume — interactive controls; the shared StatCard
                expects a static `value`, so this card stays as a local
                container. */}
            <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg p-2.5">
              <p className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1.5 font-semibold">Mode</p>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleToggleMode}
                    disabled={modeBusy}
                    className="text-xs font-medium px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                    style={{
                      color: bot.mode === 'codegen' ? '#10B981' : '#F59E0B',
                      backgroundColor: bot.mode === 'codegen' ? '#10B98112' : '#F59E0B12',
                    }}
                    title="Toggle mode"
                  >
                    {bot.mode}
                  </button>
                  <button
                    onClick={handleTogglePause}
                    disabled={modeBusy}
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-zinc-700/60 hover:bg-zinc-800/60 text-zinc-400 transition-colors disabled:opacity-50"
                    title={isPaused ? 'Resume' : 'Pause'}
                  >
                    {isPaused ? 'Resume' : 'Pause'}
                  </button>
                </div>
                {bot.voyager?.isRunning && (
                  <div className="text-[10px] text-emerald-500 mt-0.5">running</div>
                )}
              </div>
            </div>
          </div>

          {/* Tab nav */}
          <div className="flex gap-1 overflow-x-auto pb-0">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`tabpanel-${tab.id}`}
                  id={`tab-${tab.id}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                      e.preventDefault();
                      const idx = TABS.findIndex((t) => t.id === activeTab);
                      const next = e.key === 'ArrowRight'
                        ? TABS[(idx + 1) % TABS.length]
                        : TABS[(idx - 1 + TABS.length) % TABS.length];
                      setActiveTab(next.id);
                    }
                  }}
                  className={`relative px-4 py-2.5 text-xs font-medium rounded-t-lg transition-colors whitespace-nowrap ${
                    isActive
                      ? 'text-white bg-zinc-900/80'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40'
                  }`}
                >
                  {tab.label}
                  {isActive && (
                    <motion.span
                      layoutId="tab-underline"
                      className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                      style={{ backgroundColor: accentColor }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══ TAB CONTENT ═══ */}
      <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} className="p-6 lg:p-8 space-y-5">
        {activeTab === 'overview' && <BotTabOverview botName={bot.name} personality={bot.personality} />}
        {activeTab === 'console' && <BotTabConsole botName={bot.name} personality={bot.personality} />}
        {activeTab === 'tasks' && <BotTabTasks botName={bot.name} />}
        {activeTab === 'inventory' && <BotTabInventory botName={bot.name} personality={bot.personality} />}
        {activeTab === 'relationships' && (
          <BotTabRelationships botName={bot.name} personality={bot.personality} />
        )}
        {activeTab === 'reputation' && <BotTabReputation botName={bot.name} />}
        {activeTab === 'decisions' && <DecisionTimeline botName={bot.name} />}
        {activeTab === 'messages' && <MessagingPanel botName={bot.name} />}
        {activeTab === 'memory' && <SocialMemoryPanel botName={bot.name} />}
      </div>
    </div>
  );
}

// ─── Sticky-header sub-components ───

function VitalBar({
  label,
  value,
  max,
  intent,
}: {
  label: string;
  value: number;
  max: number;
  intent: 'danger' | 'warning' | 'success' | 'default';
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-zinc-500 w-3.5 shrink-0 font-medium">{label}</span>
      <div className="flex-1">
        <ProgressBar value={value} max={max} height="xs" intent={intent} />
      </div>
      <span className="text-[10px] text-zinc-400 tabular-nums w-8 text-right">
        {value}/{max}
      </span>
    </div>
  );
}
