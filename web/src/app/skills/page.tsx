'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { CopyButton } from '@/components/CopyButton';
import { PageHeader } from '@/components/PageHeader';

export default function SkillsPage() {
  const [skills, setSkills] = useState<{ name: string; code: string | null }[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fullCode, setFullCode] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getSkills()
      .then((data) => setSkills(data.skills))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-5xl">
      <PageHeader title="Skill Library" subtitle={`${skills.length} skills available${search ? ` (${filtered.length} matching)` : ''}`}>
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
      </PageHeader>

      {loading ? (
        <div className="py-16 text-center">
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-zinc-500">Loading skills...</p>
        </div>
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
              <button
                onClick={() => handleExpand(skill.name)}
                className="w-full text-left px-4 py-3 hover:bg-zinc-800/30 transition-colors flex items-center justify-between"
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

      {!loading && filtered.length === 0 && (
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
    </div>
  );
}
