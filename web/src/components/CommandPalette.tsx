'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { useBotStore, useMissionStore } from '@/lib/store';

type CommandItem = {
  id: string;
  title: string;
  subtitle?: string;
  group: 'Bots' | 'Skills' | 'Missions' | 'Pages' | 'Actions';
  keywords?: string;
  action: () => void | Promise<void>;
};

const PAGES: { label: string; path: string }[] = [
  { label: 'Dashboard', path: '/' },
  { label: 'World Map', path: '/map' },
  { label: 'Fleet', path: '/fleet' },
  { label: 'Social', path: '/social' },
  { label: 'Skills', path: '/skills' },
  { label: 'Chat', path: '/chat' },
  { label: 'Commander', path: '/commander' },
  { label: 'History', path: '/history' },
  { label: 'Activity', path: '/activity' },
  { label: 'Metrics', path: '/metrics' },
  { label: 'Stats', path: '/stats' },
  { label: 'Routines', path: '/routines' },
  { label: 'Build', path: '/build' },
  { label: 'Supply Chains', path: '/chains' },
  { label: 'Coordination', path: '/coordination' },
  { label: 'Roles', path: '/roles' },
  { label: 'Manage', path: '/manage' },
  { label: 'AI Settings', path: '/settings' },
];

function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (!n) return true;
  // Token-based AND match — every whitespace-delimited token must appear somewhere
  const tokens = n.split(/\s+/).filter(Boolean);
  return tokens.every((tok) => h.includes(tok));
}

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [skills, setSkills] = useState<{ name: string }[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const bots = useBotStore((s) => s.botList);
  const players = useBotStore((s) => s.playerList);
  const missions = useMissionStore((s) => s.missions);

  // Global Cmd+K / Ctrl+K hotkey
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore auto-repeat so holding Cmd+K doesn't oscillate the modal.
      if (e.repeat) return;
      const isK = e.key === 'k' || e.key === 'K';
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Auto-close on route change so the palette never floats over a new page
  // after browser back/forward or external navigation.
  useEffect(() => {
    if (open) setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Reset state on open and focus input
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlight(0);
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);

  // Lazy-load skills the first time the palette opens
  useEffect(() => {
    if (!open || skills.length > 0) return;
    api
      .getSkills()
      .then((data) => setSkills(data.skills.map((s) => ({ name: s.name }))))
      .catch(() => setSkills([]));
  }, [open, skills.length]);

  const close = () => setOpen(false);

  const navigate = (path: string) => {
    router.push(path);
    close();
  };

  const items = useMemo<CommandItem[]>(() => {
    const result: CommandItem[] = [];

    // Bots
    for (const bot of bots) {
      result.push({
        id: `bot:${bot.name}`,
        title: `Go to ${bot.name}`,
        subtitle: `${bot.personality ?? 'bot'} · ${bot.state ?? 'unknown'}`,
        group: 'Bots',
        keywords: `${bot.name} ${bot.personality ?? ''} ${bot.state ?? ''}`,
        action: () => navigate(`/bots/${bot.name}`),
      });
    }

    // Skills
    for (const skill of skills) {
      result.push({
        id: `skill:${skill.name}`,
        title: `Go to skill ${skill.name}`,
        subtitle: 'Open Skills page',
        group: 'Skills',
        keywords: skill.name,
        action: () => navigate(`/skills?skill=${encodeURIComponent(skill.name)}`),
      });
    }

    // Missions
    for (const mission of missions.slice(0, 30)) {
      result.push({
        id: `mission:${mission.id}`,
        title: `Mission: ${mission.title || mission.description || mission.id}`,
        subtitle: `${mission.type} · ${mission.status}`,
        group: 'Missions',
        keywords: `${mission.title} ${mission.description} ${mission.type} ${mission.status}`,
        action: () => navigate(`/coordination?mission=${encodeURIComponent(mission.id)}`),
      });
    }

    // Pages
    for (const page of PAGES) {
      result.push({
        id: `page:${page.path}`,
        title: `Go to page ${page.label}`,
        subtitle: page.path,
        group: 'Pages',
        keywords: `${page.label} ${page.path}`,
        action: () => navigate(page.path),
      });
    }

    // Verb commands
    result.push({
      id: 'action:spawn-bot',
      title: 'Spawn bot…',
      subtitle: 'Open Manage to create a new bot',
      group: 'Actions',
      keywords: 'spawn create new bot',
      action: () => navigate('/manage'),
    });

    result.push({
      id: 'action:pause-all',
      title: 'Pause all bots',
      subtitle: `${bots.length} bot${bots.length === 1 ? '' : 's'}`,
      group: 'Actions',
      keywords: 'pause stop all bots',
      action: async () => {
        close();
        await Promise.allSettled(bots.map((b) => api.pauseBot(b.name)));
      },
    });

    result.push({
      id: 'action:resume-all',
      title: 'Resume all bots',
      subtitle: `${bots.length} bot${bots.length === 1 ? '' : 's'}`,
      group: 'Actions',
      keywords: 'resume unpause all bots',
      action: async () => {
        close();
        await Promise.allSettled(bots.map((b) => api.resumeBot(b.name)));
      },
    });

    result.push({
      id: 'action:open-commander',
      title: 'Open Commander',
      subtitle: 'Natural-language fleet control',
      group: 'Actions',
      keywords: 'commander natural language',
      action: () => navigate('/commander'),
    });

    for (const player of players) {
      result.push({
        id: `action:chat:${player.name}`,
        title: `Open chat with ${player.name}`,
        subtitle: player.isOnline ? 'online' : 'offline',
        group: 'Actions',
        keywords: `chat ${player.name}`,
        action: () => navigate(`/chat?player=${encodeURIComponent(player.name)}`),
      });
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bots, players, missions, skills]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return items.slice(0, 50);
    return items
      .filter((item) => fuzzyMatch(`${item.title} ${item.keywords ?? ''}`, q))
      .slice(0, 80);
  }, [items, query]);

  // Keep highlight in bounds when filtered changes
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(0);
  }, [filtered.length, highlight]);

  // Scroll active row into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-cmd-index="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  if (!open) return null;

  // Group filtered items
  const groups: { name: CommandItem['group']; items: CommandItem[] }[] = [];
  const seen: Record<string, number> = {};
  for (const item of filtered) {
    const idx = seen[item.group];
    if (idx === undefined) {
      seen[item.group] = groups.length;
      groups.push({ name: item.group, items: [item] });
    } else {
      groups[idx].items.push(item);
    }
  }

  // Flat index mapping for keyboard nav
  const flat = filtered;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(flat.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[highlight];
      if (item) void item.action();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-2xl mx-4 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-zinc-500 shrink-0"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search bots, skills, pages, actions…"
            className="flex-1 bg-transparent text-sm text-white placeholder-zinc-500 focus:outline-none"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-2">
          {flat.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">No results.</div>
          ) : (
            groups.map((group) => (
              <div key={group.name} className="mb-2 last:mb-0">
                <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  {group.name}
                </div>
                {group.items.map((item) => {
                  const index = flat.indexOf(item);
                  const active = index === highlight;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-cmd-index={index}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => void item.action()}
                      className={`w-full text-left px-4 py-2 flex items-center justify-between gap-3 transition-colors ${
                        active ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-800/60'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm truncate">{item.title}</div>
                        {item.subtitle ? (
                          <div className="text-[11px] text-zinc-500 truncate">{item.subtitle}</div>
                        ) : null}
                      </div>
                      {active ? (
                        <kbd className="text-[10px] font-mono text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700 shrink-0">
                          ↵
                        </kbd>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-zinc-800 px-4 py-2 flex items-center justify-between text-[10px] text-zinc-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="font-mono bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-mono bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700">↵</kbd>
              select
            </span>
          </div>
          <div className="flex items-center gap-1">
            <kbd className="font-mono bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700">⌘K</kbd>
            <span>toggle</span>
          </div>
        </div>
      </div>
    </div>
  );
}
