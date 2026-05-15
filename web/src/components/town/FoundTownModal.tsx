'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { useTownStore, type StylePreset, type Town } from '@/lib/townStore';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a successful POST. Receives the freshly-created town. */
  onCreated?: (town: Town) => void;
  /** Default mayor username pulled from bot config or session. Optional. */
  defaultMayorUsername?: string;
}

type Step = 1 | 2 | 3;

const STYLE_OPTIONS: Array<{
  id: StylePreset;
  label: string;
  blurb: string;
}> = [
  {
    id: 'medieval-communal',
    label: 'Medieval Communal',
    blurb:
      'Cobblestone + oak palette, steep gabled roofs, town well, tavern, guildhall. Witcher-3-village vibe.',
  },
  {
    id: 'mid-century-civic',
    label: 'Mid-Century Civic',
    blurb:
      'Smooth-stone + concrete palette, flat roofs, columned civic entries, square blocks around a town hall.',
  },
];

const DEFAULT_MAYOR_BASE = 'Mayor Lord Savior';

export function FoundTownModal({ open, onClose, onCreated, defaultMayorUsername }: Props) {
  const { toast } = useToast();
  const upsertTown = useTownStore((s) => s.upsertTown);
  const selectTown = useTownStore((s) => s.selectTown);

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const [stylePreset, setStylePreset] = useState<StylePreset>('medieval-communal');
  // Default to "Mayor Lord Savior <username>" when we have a username; the
  // user can edit anything they like. Falls back to the bare title.
  const [mayorTitle, setMayorTitle] = useState('');
  const [x, setX] = useState('0');
  const [y, setY] = useState('64');
  const [z, setZ] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form whenever the modal opens. Pull the latest world Y as a sane
  // default Y so the modal doesn't suggest bedrock.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setName('');
    setStylePreset('medieval-communal');
    setMayorTitle(
      defaultMayorUsername
        ? `${DEFAULT_MAYOR_BASE} ${defaultMayorUsername}`
        : DEFAULT_MAYOR_BASE,
    );
    setX('0');
    setY('64');
    setZ('0');
    setError(null);
  }, [open, defaultMayorUsername]);

  if (!open) return null;

  const handleUseDefaultPos = async () => {
    // We don't have player position client-side. Try /api/world for sane
    // server defaults; on failure fall back to 0/64/0.
    try {
      const world = await api.getWorld();
      // World endpoint doesn't actually return a player position today; fall
      // back to 0/64/0 unless a future world shape adds one.
      // (Kept the await so we can swap this in trivially later.)
      void world;
    } catch {
      // ignore
    }
    setX('0');
    setY('64');
    setZ('0');
  };

  const validateStep1 = () => {
    if (!name.trim()) {
      setError('Town name is required.');
      return false;
    }
    setError(null);
    return true;
  };

  const validateStep2 = () => {
    const nx = Number(x);
    const ny = Number(y);
    const nz = Number(z);
    if ([nx, ny, nz].some((n) => !Number.isFinite(n))) {
      setError('Capital coordinates must be valid numbers.');
      return false;
    }
    setError(null);
    return true;
  };

  const handleNext = () => {
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    setStep((s) => (s + 1) as Step);
  };

  const handleBack = () => {
    setError(null);
    setStep((s) => Math.max(1, s - 1) as Step);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { town } = await api.createTown({
        name: name.trim(),
        capital: {
          x: Math.round(Number(x)),
          y: Math.round(Number(y)),
          z: Math.round(Number(z)),
        },
        stylePreset,
        mayorTitle: mayorTitle.trim() || undefined,
      });
      // Optimistically update the store so the page re-renders immediately;
      // the page's poll will reconcile from the canonical list afterwards.
      upsertTown(town as Town);
      selectTown(town.id);
      onCreated?.(town as Town);
      toast(`Founded ${town.name}`, 'success');
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to found town.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          key="dialog"
          initial={{ opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.18 }}
          className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-zinc-800/60 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white">Found a New Town</h2>
              <p className="text-[11px] text-zinc-500 mt-0.5">Step {step} of 3</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-200 transition-colors text-xl leading-none w-7 h-7 rounded hover:bg-zinc-800/60 flex items-center justify-center"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-5 space-y-4 min-h-[280px]">
            {step === 1 && (
              <div className="space-y-4">
                <label className="block">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Town name
                  </span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Riverside, Old Hollow, New Concord..."
                    className="mt-1.5 w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    autoFocus
                  />
                </label>

                <div>
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Style preset
                  </span>
                  <div className="mt-1.5 grid grid-cols-1 gap-2">
                    {STYLE_OPTIONS.map((opt) => {
                      const active = stylePreset === opt.id;
                      return (
                        <label
                          key={opt.id}
                          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                            active
                              ? 'border-emerald-500/60 bg-emerald-500/5'
                              : 'border-zinc-800 hover:border-zinc-700'
                          }`}
                        >
                          <input
                            type="radio"
                            name="stylePreset"
                            checked={active}
                            onChange={() => setStylePreset(opt.id)}
                            className="mt-1 accent-emerald-500"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-semibold text-white">{opt.label}</div>
                            <div className="text-[11px] text-zinc-500 mt-0.5">{opt.blurb}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <label className="block">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Mayor title
                  </span>
                  <input
                    type="text"
                    value={mayorTitle}
                    onChange={(e) => setMayorTitle(e.target.value)}
                    placeholder="Mayor Lord Savior packetloss404"
                    className="mt-1.5 w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <p className="text-[10px] text-zinc-600 mt-1">
                    How residents greet you. Editable later from settings.
                  </p>
                </label>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Town center (capital)
                  </span>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    In Phase 2 you'll be able to click the map. For now, enter coordinates.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="text-[10px] text-zinc-500 uppercase font-semibold">X</span>
                    <input
                      type="number"
                      value={x}
                      onChange={(e) => setX(e.target.value)}
                      className="mt-1 w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-zinc-500 uppercase font-semibold">Y</span>
                    <input
                      type="number"
                      value={y}
                      onChange={(e) => setY(e.target.value)}
                      className="mt-1 w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-zinc-500 uppercase font-semibold">Z</span>
                    <input
                      type="number"
                      value={z}
                      onChange={(e) => setZ(e.target.value)}
                      className="mt-1 w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={handleUseDefaultPos}
                  className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  Use my current position
                </button>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <p className="text-sm text-zinc-300">
                  Found <span className="font-bold text-white">{name.trim() || 'Untitled'}</span> as a{' '}
                  <span className="font-bold text-emerald-400">
                    {STYLE_OPTIONS.find((o) => o.id === stylePreset)?.label}
                  </span>{' '}
                  town at{' '}
                  <span className="font-mono text-zinc-200">
                    ({Math.round(Number(x) || 0)}, {Math.round(Number(y) || 0)},{' '}
                    {Math.round(Number(z) || 0)})
                  </span>
                  ?
                </p>
                <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg p-3 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">Mayor title</span>
                    <span className="text-zinc-200">{mayorTitle || '—'}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">Initial tier</span>
                    <span className="text-zinc-200">Founding</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">Autonomy</span>
                    <span className="text-zinc-500 italic">Phase 2 — currently shell only</span>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-zinc-800/60 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={step === 1 ? onClose : handleBack}
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-3 py-1.5 rounded-md hover:bg-zinc-800/60"
              disabled={submitting}
            >
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            {step < 3 ? (
              <button
                type="button"
                onClick={handleNext}
                className="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors px-4 py-1.5 rounded-md disabled:opacity-50"
                disabled={submitting}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors px-4 py-1.5 rounded-md disabled:opacity-50 disabled:cursor-wait"
              >
                {submitting ? 'Founding…' : 'Confirm & Found Town'}
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
