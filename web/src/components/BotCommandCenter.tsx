'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { api, type CommandType, type CommandRecord } from '@/lib/api';
import { useBotStore, useControlStore } from '@/lib/store';

interface Props {
  botName: string;
  state: string;
  voyagerPaused?: boolean;
  voyagerRunning?: boolean;
  mode: string;
}

/** Status label for the last command */
function commandStatusLabel(status: CommandRecord['status']): string {
  switch (status) {
    case 'queued': return 'Command queued...';
    case 'started': return 'Command running...';
    case 'succeeded': return 'Command succeeded';
    case 'failed': return 'Command failed';
    case 'cancelled': return 'Command cancelled';
    default: return '';
  }
}

/** Dot color class for command status */
function statusDotColor(status: CommandRecord['status']): string {
  switch (status) {
    case 'queued': return 'bg-yellow-400';
    case 'started': return 'bg-blue-400';
    case 'succeeded': return 'bg-emerald-400';
    case 'failed': return 'bg-red-400';
    case 'cancelled': return 'bg-zinc-400';
    default: return 'bg-zinc-500';
  }
}

/** Human-friendly command type label */
function commandTypeLabel(type: CommandType): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function BotCommandCenter({ botName, state, voyagerPaused, voyagerRunning, mode }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [followTarget, setFollowTarget] = useState('');
  const [walkCoords, setWalkCoords] = useState('');
  const [showWalkInput, setShowWalkInput] = useState(false);
  const [showFollowInput, setShowFollowInput] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [lastCommandId, setLastCommandId] = useState<string | null>(null);
  const players = useBotStore((s) => s.playerList).filter((p) => p.isOnline);

  const pushCommand = useControlStore((s) => s.upsertCommand);
  const recentCommands = useControlStore((s) =>
    s.commandHistory.filter((c) => c.targets.includes(botName)).slice(0, 5)
  );

  // Find the last command to show live status updates
  const lastCommand = lastCommandId
    ? recentCommands.find((c) => c.id === lastCommandId)
    : null;

  /** Send a command via the new command API, falling back to legacy endpoints */
  const execCommand = useCallback(async (
    label: string,
    cmdType: CommandType,
    payload?: Record<string, unknown>,
    legacyFallback?: () => Promise<unknown>,
  ) => {
    setLoading(label);
    setFeedback(null);
    try {
      const { command } = await api.createCommand({
        type: cmdType,
        scope: 'bot',
        targets: [botName],
        payload,
        source: 'dashboard',
      });
      pushCommand(command);
      setLastCommandId(command.id);
      setFeedback({ msg: commandStatusLabel(command.status), ok: true });
    } catch (err: unknown) {
      // Fall back to legacy API if command endpoint is unavailable (404)
      const isNotFound = err instanceof Error && err.message.includes('404');
      if (isNotFound && legacyFallback) {
        try {
          await legacyFallback();
          setFeedback({ msg: `${label} sent`, ok: true });
        } catch (fallbackErr: unknown) {
          const msg = fallbackErr instanceof Error ? fallbackErr.message : 'Failed';
          setFeedback({ msg, ok: false });
        }
      } else {
        const msg = err instanceof Error ? err.message : 'Failed';
        setFeedback({ msg, ok: false });
      }
    }
    setLoading(null);
    setTimeout(() => setFeedback(null), 4000);
  }, [botName, pushCommand]);

  const handleWalkTo = () => {
    const parts = walkCoords.split(/[,\s]+/).map(Number);
    if (parts.length < 2 || parts.some(isNaN)) return;
    const [x, zOrY, maybeZ] = parts;
    const hasY = parts.length >= 3;
    const payload = hasY
      ? { x, y: zOrY, z: maybeZ }
      : { x, y: null, z: zOrY };
    execCommand(
      'Walk to',
      'walk_to_coords',
      payload as Record<string, unknown>,
      () => api.walkTo(botName, x, hasY ? zOrY : null, hasY ? maybeZ : zOrY),
    );
    setWalkCoords('');
    setShowWalkInput(false);
  };

  const handleFollow = (playerName: string) => {
    execCommand(
      'Follow',
      'follow_player',
      { playerName },
      () => api.followPlayer(botName, playerName),
    );
    setFollowTarget('');
    setShowFollowInput(false);
  };

  const isDisconnected = state === 'DISCONNECTED';
  const isCodegen = mode === 'codegen';

  // Derive feedback from last command's live status when available
  const liveFeedback = lastCommand && lastCommand.status !== 'queued'
    ? {
        msg: lastCommand.error
          ? `${commandStatusLabel(lastCommand.status)}: ${lastCommand.error.message}`
          : commandStatusLabel(lastCommand.status),
        ok: lastCommand.status === 'succeeded' || lastCommand.status === 'started',
      }
    : null;

  const displayFeedback = liveFeedback || feedback;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4"
    >
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Commands</h2>

      {/* Feedback */}
      {displayFeedback && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className={`text-xs px-3 py-1.5 rounded-lg mb-3 ${displayFeedback.ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}
        >
          {displayFeedback.msg}
        </motion.div>
      )}

      {/* Main action buttons */}
      <div className="flex flex-wrap gap-2 mb-3">
        {isCodegen && voyagerRunning && (
          <CmdButton
            label={voyagerPaused ? 'Resume' : 'Pause'}
            icon={voyagerPaused ? '\u25B6' : '\u23F8'}
            color={voyagerPaused ? '#10B981' : '#F59E0B'}
            loading={loading === (voyagerPaused ? 'Resume' : 'Pause')}
            disabled={isDisconnected}
            onClick={() => execCommand(
              voyagerPaused ? 'Resume' : 'Pause',
              voyagerPaused ? 'resume_voyager' : 'pause_voyager',
              undefined,
              () => voyagerPaused ? api.resumeBot(botName) : api.pauseBot(botName),
            )}
          />
        )}
        <CmdButton
          label="Stop"
          icon="\u25A0"
          color="#EF4444"
          loading={loading === 'Stop'}
          disabled={isDisconnected || state === 'IDLE'}
          onClick={() => execCommand(
            'Stop',
            'stop_movement',
            undefined,
            () => api.stopBot(botName),
          )}
        />
        <CmdButton
          label="Follow"
          icon="\uD83D\uDC64"
          color="#8B5CF6"
          loading={loading === 'Follow'}
          disabled={isDisconnected}
          onClick={() => { setShowFollowInput(!showFollowInput); setShowWalkInput(false); }}
          active={showFollowInput}
        />
        <CmdButton
          label="Go To"
          icon="\uD83D\uDCCD"
          color="#3B82F6"
          loading={loading === 'Walk to'}
          disabled={isDisconnected}
          onClick={() => { setShowWalkInput(!showWalkInput); setShowFollowInput(false); }}
          active={showWalkInput}
        />
      </div>

      {/* Follow input */}
      {showFollowInput && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="overflow-hidden mb-2"
        >
          {players.length > 0 ? (
            <div className="space-y-1">
              <p className="text-[10px] text-zinc-500 mb-1">Select player to follow:</p>
              {players.map((p) => (
                <button
                  key={p.name}
                  onClick={() => handleFollow(p.name)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  <img src={`https://mc-heads.net/avatar/${p.name}/16`} alt="" className="w-4 h-4 rounded pixelated" style={{ imageRendering: 'pixelated' }} />
                  {p.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                value={followTarget}
                onChange={(e) => setFollowTarget(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && followTarget.trim() && handleFollow(followTarget.trim())}
                placeholder="Player name..."
                className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600"
                autoFocus
              />
              <button
                onClick={() => followTarget.trim() && handleFollow(followTarget.trim())}
                disabled={!followTarget.trim()}
                className="bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 text-white px-3 py-1.5 rounded-lg text-xs transition-colors"
              >
                Go
              </button>
            </div>
          )}
        </motion.div>
      )}

      {/* Walk to input */}
      {showWalkInput && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="overflow-hidden"
        >
          <div className="flex gap-2">
            <input
              value={walkCoords}
              onChange={(e) => setWalkCoords(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleWalkTo()}
              placeholder="x, z  or  x, y, z"
              className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600 font-mono"
              autoFocus
            />
            <button
              onClick={handleWalkTo}
              className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs transition-colors"
            >
              Go
            </button>
          </div>
          <p className="text-[9px] text-zinc-600 mt-1">Enter coordinates separated by commas or spaces</p>
        </motion.div>
      )}

      {/* Recent Commands */}
      {recentCommands.length > 0 && (
        <div className="mt-3 pt-3 border-t border-zinc-800/60">
          <h3 className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-2">Recent Commands</h3>
          <div className="space-y-1">
            {recentCommands.map((cmd) => (
              <div key={cmd.id} className="flex items-center gap-2 text-[11px] text-zinc-400">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotColor(cmd.status)}`} />
                <span className="truncate flex-1">{commandTypeLabel(cmd.type)}</span>
                <span className="text-zinc-600 text-[10px] flex-shrink-0">
                  {new Date(cmd.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function CmdButton({
  label, icon, color, loading, disabled, onClick, active,
}: {
  label: string; icon: string; color: string; loading: boolean; disabled: boolean; onClick: () => void; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
        disabled ? 'opacity-30 cursor-not-allowed' : 'hover:brightness-110'
      }`}
      style={{
        color,
        borderColor: active ? `${color}50` : `${color}25`,
        backgroundColor: active ? `${color}15` : `${color}08`,
      }}
    >
      {loading ? (
        <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
      ) : (
        <span className="text-[10px]">{icon}</span>
      )}
      {label}
    </button>
  );
}
