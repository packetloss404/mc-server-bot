'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { CopyButton } from '@/components/CopyButton';
import { PageHeader } from '@/components/PageHeader';
import { SkillGraph, type SkillNodeData } from '@/components/skills/SkillGraph';
import { SkillEditor } from '@/components/skills/SkillEditor';

type ViewMode = 'list' | 'graph';

function readViewFromHash(): ViewMode {
  if (typeof window === 'undefined') return 'list';
  const hash = window.location.hash || '';
  const match = hash.match(/view=([a-z]+)/i);
  return match && match[1].toLowerCase() === 'graph' ? 'graph' : 'list';
}

function writeViewToHash(view: ViewMode) {
  if (typeof window === 'undefined') return;
  const next = view === 'graph' ? '#view=graph' : '';
  if (window.location.hash !== next) {
    // Preserve current URL apart from the hash.
    const url = window.location.pathname + window.location.search + next;
    window.history.replaceState(null, '', url);
  }
}

export default function SkillsPage() {
  // /api/skills returns more fields than api.ts declares — widen with a cast.
  const [skills, setSkills] = useState<SkillNodeData[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fullCode, setFullCode] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>('list');
  const [editingSkill, setEditingSkill] = useState<SkillNodeData | null>(null);
  const [deletingSkill, setDeletingSkill] = useState<SkillNodeData | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Sync view mode with URL hash (read on mount, listen for changes).
  useEffect(() => {
    setView(readViewFromHash());
    const onHash = () => setView(readViewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const refreshSkills = () => {
    api.getSkills()
      .then((data) => setSkills(data.skills as unknown as SkillNodeData[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refreshSkills();
  }, []);

  const handleDelete = async () => {
    if (!deletingSkill) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteSkill(deletingSkill.name);
      setDeletingSkill(null);
      refreshSkills();
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  const filtered = search
    ? skills.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
    : skills;

  const handleExpand = async (name: string) => {
    if (expanded === name) {
      setExpanded(null);
      setFullCode(null);
      return;
    }
    setExpanded(name);
    setFullCode(null);
    try {
      const data = await api.getSkill(name);
      setFullCode(data.code);
    } catch {
      setFullCode('// Failed to load code');
    }
  };

  const switchView = (next: ViewMode) => {
    setView(next);
    writeViewToHash(next);
  };

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-5xl">
      <PageHeader title="Skill Library" subtitle={`${skills.length} skills available${search && view === 'list' ? ` (${filtered.length} matching)` : ''}`}>
        <div className="flex items-center gap-2">
          <div className="inline-flex bg-zinc-800/80 border border-zinc-700/50 rounded-lg p-0.5">
            <button
              onClick={() => switchView('list')}
              className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
                view === 'list' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
              }`}
              aria-pressed={view === 'list'}
            >
              List
            </button>
            <button
              onClick={() => switchView('graph')}
              className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
                view === 'graph' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
              }`}
              aria-pressed={view === 'graph'}
            >
              Graph
            </button>
          </div>
          {view === 'list' && (
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search skills..."
                className="bg-zinc-800/80 border border-zinc-700/50 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-500 w-64"
              />
            </div>
          )}
        </div>
      </PageHeader>

      {loading ? (
        <div className="py-16 text-center">
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-zinc-500">Loading skills...</p>
        </div>
      ) : view === 'graph' ? (
        <SkillGraph skills={skills} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((skill, i) => (
            <motion.div
              key={skill.name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.5) }}
              className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden"
            >
              <div className="flex items-center pr-2">
                <button
                  onClick={() => handleExpand(skill.name)}
                  className="flex-1 text-left px-4 py-3 hover:bg-zinc-800/30 transition-colors flex items-center justify-between"
                >
                  <div>
                    <h3 className="text-sm font-medium text-white">{skill.name.replace(/_/g, ' ')}</h3>
                    <p className="text-[10px] text-zinc-600 font-mono mt-0.5">{skill.name}</p>
                  </div>
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2"
                    className={`transition-transform ${expanded === skill.name ? 'rotate-180' : ''}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <div className="flex items-center gap-1 pl-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingSkill(skill);
                    }}
                    className="p-1.5 rounded-md text-zinc-500 hover:text-teal-300 hover:bg-zinc-800/60 transition-colors"
                    title="Edit skill"
                    aria-label={`Edit ${skill.name}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeletingSkill(skill);
                      setDeleteError(null);
                    }}
                    className="p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-zinc-800/60 transition-colors"
                    title="Delete skill"
                    aria-label={`Delete ${skill.name}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
              <AnimatePresence>
                {expanded === skill.name && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-zinc-800/60 px-4 py-3 max-h-80 overflow-auto bg-zinc-950/50">
                      {fullCode ? (
                        <div className="relative group">
                          <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <CopyButton text={fullCode} />
                          </div>
                          <pre className="text-xs text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed">{fullCode}</pre>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 py-4">
                          <div className="w-4 h-4 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
                          <span className="text-xs text-zinc-500">Loading code...</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      )}

      {!loading && view === 'list' && filtered.length === 0 && (
        <div className="text-center py-16 bg-zinc-900/50 rounded-xl border border-zinc-800/40">
          <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
          </div>
          <p className="text-sm text-zinc-500">{search ? 'No skills matching search' : 'No skills in library yet'}</p>
          <p className="text-xs text-zinc-600 mt-1">Bots learn new skills as they complete tasks</p>
        </div>
      )}

      <AnimatePresence>
        {editingSkill && (
          <SkillEditor
            key={editingSkill.name}
            name={editingSkill.name}
            initialDescription={(editingSkill as unknown as { description?: string | null }).description ?? null}
            initialKeywords={(editingSkill as unknown as { keywords?: string[] }).keywords ?? []}
            onClose={() => setEditingSkill(null)}
            onSaved={() => {
              // Invalidate the locally cached expanded code so the next expand fetches fresh.
              if (expanded === editingSkill.name) setFullCode(null);
              refreshSkills();
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deletingSkill && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={() => !deleting && setDeletingSkill(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-zinc-950 border border-red-500/30 rounded-xl p-5 max-w-md w-full space-y-3"
            >
              <h2 className="text-sm font-semibold text-white">Delete skill?</h2>
              <p className="text-xs text-zinc-400">
                Delete <span className="font-mono text-zinc-200">{deletingSkill.name}</span>?
                This cannot be undone.
              </p>
              {deleteError && (
                <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {deleteError}
                </p>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => setDeletingSkill(null)}
                  disabled={deleting}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800/80 border border-zinc-700/50 text-zinc-300 hover:text-white hover:border-zinc-600/60 disabled:opacity-40 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/20 border border-red-500/40 text-red-200 hover:bg-red-500/30 disabled:opacity-40 transition-colors"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
