'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { useBotStore } from '@/lib/store';
import { useToast } from '@/components/Toast';
import { CommandButtonGroup } from '@/components/CommandButtonGroup';

interface Props {
  botName: string;
  state: string;
  voyagerPaused?: boolean;
  voyagerRunning?: boolean;
  mode: string;
}

export function BotCommandCenter({ botName, state, voyagerPaused, voyagerRunning, mode }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [followTarget, setFollowTarget] = useState('');
  const [walkCoords, setWalkCoords] = useState('');
  const [showWalkInput, setShowWalkInput] = useState(false);
  const [showFollowInput, setShowFollowInput] = useState(false);
  const players = useBotStore((s) => s.playerList).filter((p) => p.isOnline);
  const { toast } = useToast();

  const exec = async (label: string, fn: () => Promise<any>) => {
    setLoading(label);
    try {
      await fn();
      toast(`${label} sent`, 'success');
    } catch (e: any) {
      toast(e.message || 'Failed', 'error');
    }
    setLoading(null);
  };

  const handleWalkTo = () => {
    const parts = walkCoords.split(/[,\s]+/).map(Number);
    if (parts.length < 2 || parts.some(isNaN)) return;
    const [x, zOrY, maybeZ] = parts;
    const hasY = parts.length >= 3;
    exec('Walk to', () => api.walkTo(botName, x, hasY ? zOrY : null, hasY ? maybeZ : zOrY));
    setWalkCoords('');
    setShowWalkInput(false);
  };

  const handleFollow = (playerName: string) => {
    exec('Follow', () => api.followPlayer(botName, playerName));
    setFollowTarget('');
    setShowFollowInput(false);
  };

  const isDisconnected = state === 'DISCONNECTED';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4"
    >
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Commands</h2>

      {/* Standard command buttons */}
      <div className="mb-3">
        <CommandButtonGroup
          targetBotNames={[botName]}
          variant="full"
          disabled={isDisconnected}
        />
      </div>

      {/* Interactive action buttons (Follow, Go To) */}
      <div className="flex flex-wrap gap-2 mb-3">
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
