'use client';

import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';

export interface CommandButtonGroupProps {
  /** Bot names to target -- commands are sent to every bot in the array */
  targetBotNames: string[];
  /** 'compact' shows icons only; 'full' shows icon + label */
  variant?: 'compact' | 'full';
  /** Disable all buttons (e.g. when no bots are selected) */
  disabled?: boolean;
}

interface CommandDef {
  key: string;
  label: string;
  icon: string;
  color: string;
  /** Execute the command for a single bot and return a promise */
  action: (botName: string) => Promise<any>;
}

const COMMANDS: CommandDef[] = [
  {
    key: 'pause',
    label: 'Pause',
    icon: '\u23F8',
    color: '#F59E0B',
    action: (bot) => api.pauseBot(bot),
  },
  {
    key: 'resume',
    label: 'Resume',
    icon: '\u25B6',
    color: '#10B981',
    action: (bot) => api.resumeBot(bot),
  },
  {
    key: 'stop',
    label: 'Stop',
    icon: '\u25A0',
    color: '#EF4444',
    action: (bot) => api.stopBot(bot),
  },
  {
    key: 'return-to-base',
    label: 'Return to Base',
    icon: '\uD83C\uDFE0',
    color: '#3B82F6',
    action: (bot) => api.returnToBase(bot),
  },
  {
    key: 'unstuck',
    label: 'Unstuck',
    icon: '\uD83D\uDD04',
    color: '#8B5CF6',
    action: (bot) => api.unstuck(bot),
  },
  {
    key: 'equip-best',
    label: 'Equip Best',
    icon: '\uD83D\uDEE1',
    color: '#F97316',
    action: (bot) => api.equipBest(bot),
  },
];

export function CommandButtonGroup({
  targetBotNames,
  variant = 'full',
  disabled = false,
}: CommandButtonGroupProps) {
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const { toast } = useToast();

  const exec = useCallback(
    async (cmd: CommandDef) => {
      if (targetBotNames.length === 0) return;
      setLoadingKey(cmd.key);
      try {
        // Fan-out: send the command to every target bot in parallel
        await Promise.all(targetBotNames.map((bot) => cmd.action(bot)));
        const botLabel =
          targetBotNames.length === 1
            ? targetBotNames[0]
            : `${targetBotNames.length} bots`;
        toast(`${cmd.label} sent to ${botLabel}`, 'success');
      } catch (e: any) {
        toast(e.message || `${cmd.label} failed`, 'error');
      } finally {
        setLoadingKey(null);
      }
    },
    [targetBotNames, toast],
  );

  const isCompact = variant === 'compact';

  return (
    <div className="flex flex-wrap gap-1.5">
      {COMMANDS.map((cmd) => {
        const isLoading = loadingKey === cmd.key;
        const isDisabled = disabled || targetBotNames.length === 0 || isLoading;

        return (
          <button
            key={cmd.key}
            onClick={() => exec(cmd)}
            disabled={isDisabled}
            title={isCompact ? cmd.label : undefined}
            className={`flex items-center gap-1.5 rounded-lg text-xs font-medium transition-all border ${
              isDisabled
                ? 'opacity-30 cursor-not-allowed'
                : 'hover:brightness-110 cursor-pointer'
            } ${isCompact ? 'px-2 py-1.5' : 'px-3 py-1.5'}`}
            style={{
              color: cmd.color,
              borderColor: `${cmd.color}25`,
              backgroundColor: `${cmd.color}08`,
            }}
          >
            {isLoading ? (
              <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
            ) : (
              <span className="text-[10px]">{cmd.icon}</span>
            )}
            {!isCompact && cmd.label}
          </button>
        );
      })}
    </div>
  );
}
