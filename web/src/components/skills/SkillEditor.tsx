'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';

interface Props {
  name: string;
  initialDescription?: string | null;
  initialKeywords?: string[];
  onClose: () => void;
  onSaved?: () => void;
}

/** Validate JS by attempting to construct a Function from it. */
function validateJs(code: string): { ok: true } | { ok: false; error: string } {
  try {
    // eslint-disable-next-line no-new-func
    new Function(code);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function SkillEditor({ name, initialDescription, initialKeywords, onClose, onSaved }: Props) {
  const [code, setCode] = useState<string>('');
  const [description, setDescription] = useState<string>(initialDescription ?? '');
  const [keywordsRaw, setKeywordsRaw] = useState<string>((initialKeywords ?? []).join(', '));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  // Load current skill code.
  useEffect(() => {
    let cancelled = false;
    api.getSkill(name)
      .then((data) => {
        if (!cancelled) setCode(data.code ?? '');
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load skill');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const doSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const keywords = keywordsRaw
        .split(/[,\n]+/)
        .map((k) => k.trim())
        .filter(Boolean);
      await api.updateSkill(name, { code, description, keywords });
      onSaved?.();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  };

  const handleSave = () => {
    const validation = validateJs(code);
    if (!validation.ok) {
      setValidationMessage(validation.error);
      setConfirmOpen(true);
      return;
    }
    setValidationMessage(null);
    void doSave();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 360, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[90vh] bg-zinc-950 border border-zinc-800/60 rounded-xl shadow-2xl flex flex-col"
      >
        <div className="px-5 py-4 border-b border-zinc-800/60 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Edit Skill</h2>
            <p className="text-[11px] text-zinc-500 font-mono mt-0.5">{name}</p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors"
            aria-label="Close editor"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="space-y-1">
            <label htmlFor="skill-desc" className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
              Description
            </label>
            <input
              id="skill-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this skill do?"
              className="w-full bg-zinc-900/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-teal-500/40"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="skill-keywords" className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
              Keywords (comma-separated)
            </label>
            <input
              id="skill-keywords"
              type="text"
              value={keywordsRaw}
              onChange={(e) => setKeywordsRaw(e.target.value)}
              placeholder="mine, oak, log"
              className="w-full bg-zinc-900/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-teal-500/40"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="skill-code" className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
              Code
            </label>
            {loading ? (
              <div className="py-10 text-center">
                <div className="w-6 h-6 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-2" />
                <p className="text-xs text-zinc-500">Loading code...</p>
              </div>
            ) : (
              <textarea
                id="skill-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                spellCheck={false}
                rows={20}
                className="w-full bg-zinc-900/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-[12px] text-zinc-200 font-mono leading-relaxed resize-y focus:outline-none focus:border-teal-500/40"
              />
            )}
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-800/60 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800/80 border border-zinc-700/50 text-zinc-300 hover:text-white hover:border-zinc-600/60 transition-colors"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading || code.length === 0}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-teal-600/20 border border-teal-500/40 text-teal-300 hover:bg-teal-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>

        {/* Inline confirm-on-syntax-error dialog */}
        <AnimatePresence>
          {confirmOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 rounded-xl flex items-center justify-center p-6"
              onClick={() => setConfirmOpen(false)}
            >
              <motion.div
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-zinc-950 border border-red-500/40 rounded-xl p-5 max-w-md w-full space-y-3"
              >
                <h3 className="text-sm font-semibold text-red-300">Syntax error in code</h3>
                <p className="text-xs text-zinc-400">
                  The code didn&apos;t parse cleanly. The server will reject this save with the same error
                  unless you fix it first.
                </p>
                {validationMessage && (
                  <pre className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/20 rounded p-2 font-mono whitespace-pre-wrap">
                    {validationMessage}
                  </pre>
                )}
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => setConfirmOpen(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800/80 border border-zinc-700/50 text-zinc-300 hover:text-white hover:border-zinc-600/60 transition-colors"
                  >
                    Go Back
                  </button>
                  <button
                    onClick={() => void doSave()}
                    disabled={saving}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/20 border border-red-500/40 text-red-200 hover:bg-red-500/30 disabled:opacity-40 transition-colors"
                  >
                    {saving ? 'Saving...' : 'Save Anyway'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
