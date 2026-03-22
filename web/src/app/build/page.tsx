'use client';

import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, SchematicInfo, BuildJob } from '@/lib/api';
import { useBotStore } from '@/lib/store';
import { PageHeader } from '@/components/PageHeader';

const STATUS_COLORS: Record<string, string> = {
  waiting: '#6B7280',
  building: '#1ABC9C',
  completed: '#10B981',
  failed: '#EF4444',
  pending: '#F59E0B',
  running: '#1ABC9C',
  paused: '#F59E0B',
  cancelled: '#EF4444',
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? '#6B7280';
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: `${color}20`, color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {status}
    </span>
  );
}

function ProgressBar({ value, max, color = '#1ABC9C' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      />
    </div>
  );
}

export default function BuildPage() {
  const [schematics, setSchematics] = useState<SchematicInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSchematic, setSelectedSchematic] = useState<SchematicInfo | null>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 64, z: 0 });
  const [selectedBots, setSelectedBots] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const botList = useBotStore((s) => s.botList);
  const activeBuild = useBotStore((s) => s.activeBuild);
  const setActiveBuild = useBotStore((s) => s.setActiveBuild);

  const connectedBots = useMemo(
    () => botList.filter((b) => b.state !== 'DISCONNECTED'),
    [botList],
  );

  // Fetch schematics on mount
  useEffect(() => {
    api.getSchematics()
      .then((data) => setSchematics(data.schematics))
      .catch(() => setSchematics([]))
      .finally(() => setLoading(false));

    // Also check for active builds
    api.getBuilds()
      .then((data) => {
        const running = data.builds.find((b) => b.status === 'running' || b.status === 'paused');
        if (running) setActiveBuild(running);
      })
      .catch(() => {});
  }, [setActiveBuild]);

  const toggleBot = (name: string) => {
    setSelectedBots((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const layerPreview = useMemo(() => {
    if (!selectedSchematic || selectedBots.size === 0) return [];
    const bots = Array.from(selectedBots);
    const totalY = selectedSchematic.size.y;
    const layersPerBot = Math.ceil(totalY / bots.length);
    return bots.map((name, i) => ({
      botName: name,
      yMin: i * layersPerBot,
      yMax: Math.min((i + 1) * layersPerBot - 1, totalY - 1),
    }));
  }, [selectedSchematic, selectedBots]);

  const handleStartBuild = async () => {
    if (!selectedSchematic || selectedBots.size === 0) return;
    setStarting(true);
    setError(null);
    try {
      const result = await api.startBuild(
        selectedSchematic.filename,
        origin,
        Array.from(selectedBots),
      );
      setActiveBuild(result.build);
      setSelectedSchematic(null);
      setSelectedBots(new Set());
    } catch (err: any) {
      setError(err.message || 'Failed to start build');
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    if (!activeBuild) return;
    try {
      await api.cancelBuild(activeBuild.id);
      setActiveBuild(null);
    } catch {}
  };

  const handlePause = async () => {
    if (!activeBuild) return;
    try {
      await api.pauseBuild(activeBuild.id);
      setActiveBuild({ ...activeBuild, status: 'paused' });
    } catch {}
  };

  const handleResume = async () => {
    if (!activeBuild) return;
    try {
      await api.resumeBuild(activeBuild.id);
      setActiveBuild({ ...activeBuild, status: 'running' });
    } catch {}
  };

  const overallPct = activeBuild && activeBuild.totalBlocks > 0
    ? Math.round(((activeBuild.placedBlocks ?? 0) / activeBuild.totalBlocks) * 100)
    : 0;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-5xl">
      <PageHeader
        title="Blueprint Builder"
        subtitle="Multi-bot coordinated building from schematics"
      />

      {/* Active Build Monitor */}
      <AnimatePresence>
        {activeBuild && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: '#1ABC9C20' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1ABC9C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 20h20" />
                    <path d="M5 20V8l7-5 7 5v12" />
                    <path d="M9 20v-4h6v4" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Active Build</h2>
                  <p className="text-[11px] text-zinc-500">{activeBuild.schematicFile}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={activeBuild.status} />
                {activeBuild.status === 'running' && (
                  <button
                    onClick={handlePause}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors"
                  >
                    Pause
                  </button>
                )}
                {activeBuild.status === 'paused' && (
                  <button
                    onClick={handleResume}
                    className="px-3 py-1.5 bg-teal-600/20 hover:bg-teal-600/30 text-teal-400 text-xs font-medium rounded-lg transition-colors"
                  >
                    Resume
                  </button>
                )}
                {(activeBuild.status === 'running' || activeBuild.status === 'paused') && (
                  <button
                    onClick={handleCancel}
                    className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {/* Overall Progress */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Overall Progress</span>
                <span className="text-white font-medium">
                  {(activeBuild.placedBlocks ?? 0).toLocaleString()} / {(activeBuild.totalBlocks ?? 0).toLocaleString()} blocks ({overallPct}%)
                </span>
              </div>
              <ProgressBar value={activeBuild.placedBlocks ?? 0} max={activeBuild.totalBlocks ?? 0} />
            </div>

            {/* Per-Bot Assignments */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(activeBuild.assignments ?? []).map((assignment) => {
                const botPct = assignment.blocksTotal > 0
                  ? Math.round((assignment.blocksPlaced / assignment.blocksTotal) * 100)
                  : 0;
                return (
                  <motion.div
                    key={assignment.botName}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-zinc-800/50 border border-zinc-700/40 rounded-lg p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-white">{assignment.botName}</span>
                      <StatusBadge status={assignment.status} />
                    </div>
                    <div className="text-[10px] text-zinc-500 flex items-center gap-3">
                      <span>Y: {assignment.yMin} - {assignment.yMax}</span>
                      <span>Current Y: {assignment.currentY}</span>
                    </div>
                    <ProgressBar value={assignment.blocksPlaced} max={assignment.blocksTotal} color="#0EA5E9" />
                    <div className="text-[10px] text-zinc-500 text-right">
                      {assignment.blocksPlaced} / {assignment.blocksTotal} ({botPct}%)
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Schematic Selection */}
      {!activeBuild && (
        <>
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Select Schematic</h2>
            {loading ? (
              <div className="py-12 text-center">
                <div className="w-6 h-6 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-3" />
                <p className="text-xs text-zinc-500">Loading schematics...</p>
              </div>
            ) : schematics.length === 0 ? (
              <div className="text-center py-12 bg-zinc-900/50 rounded-xl border border-zinc-800/40">
                <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 20h20" />
                    <path d="M5 20V8l7-5 7 5v12" />
                    <path d="M9 20v-4h6v4" />
                  </svg>
                </div>
                <p className="text-sm text-zinc-500">No schematics available</p>
                <p className="text-xs text-zinc-600 mt-1">Add .schem or .schematic files to the schematics directory</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {schematics.map((schem, i) => {
                  const isSelected = selectedSchematic?.filename === schem.filename;
                  return (
                    <motion.button
                      key={schem.filename}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.05, 0.3) }}
                      onClick={() => setSelectedSchematic(isSelected ? null : schem)}
                      className={`text-left bg-zinc-900/80 border rounded-xl p-4 transition-all duration-150 ${
                        isSelected
                          ? 'border-teal-500/60 ring-1 ring-teal-500/20'
                          : 'border-zinc-800/60 hover:border-zinc-700/60'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="text-sm font-medium text-white truncate pr-2">
                          {schem.filename.replace(/\.(schem|schematic)$/i, '')}
                        </h3>
                        {isSelected && (
                          <span className="shrink-0 w-5 h-5 rounded-full bg-teal-500/20 flex items-center justify-center">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1ABC9C" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                        <span>{schem.size.x} x {schem.size.y} x {schem.size.z}</span>
                        <span className="text-zinc-700">|</span>
                        <span>{schem.blockCount.toLocaleString()} blocks</span>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Build Configuration */}
          <AnimatePresence>
            {selectedSchematic && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5 space-y-5">
                  <h2 className="text-sm font-semibold text-white">Build Configuration</h2>

                  {/* Origin Coordinates */}
                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 font-medium">Origin Coordinates</label>
                    <div className="flex items-center gap-3">
                      {(['x', 'y', 'z'] as const).map((axis) => (
                        <div key={axis} className="flex items-center gap-1.5">
                          <span className="text-[10px] text-zinc-600 uppercase font-bold w-3">{axis}</span>
                          <input
                            type="number"
                            value={origin[axis]}
                            onChange={(e) => setOrigin((prev) => ({ ...prev, [axis]: parseInt(e.target.value) || 0 }))}
                            className="bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white w-24 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Bot Selector */}
                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 font-medium">Assign Bots</label>
                    {connectedBots.length === 0 ? (
                      <p className="text-xs text-zinc-600">No connected bots available</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {connectedBots.map((bot) => {
                          const checked = selectedBots.has(bot.name);
                          return (
                            <button
                              key={bot.name}
                              onClick={() => toggleBot(bot.name)}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                                checked
                                  ? 'bg-teal-500/15 border border-teal-500/40 text-teal-300'
                                  : 'bg-zinc-800/60 border border-zinc-700/40 text-zinc-400 hover:text-zinc-300 hover:border-zinc-600/60'
                              }`}
                            >
                              <span
                                className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center transition-colors ${
                                  checked ? 'border-teal-500 bg-teal-500' : 'border-zinc-600'
                                }`}
                              >
                                {checked && (
                                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                )}
                              </span>
                              {bot.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Layer Preview */}
                  {layerPreview.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-xs text-zinc-400 font-medium">Layer Assignment Preview</label>
                      <div className="bg-zinc-800/40 rounded-lg p-3 space-y-1.5">
                        {layerPreview.map((lp, i) => {
                          const range = lp.yMax - lp.yMin + 1;
                          const pct = selectedSchematic ? Math.round((range / selectedSchematic.size.y) * 100) : 0;
                          return (
                            <div key={lp.botName} className="flex items-center gap-3 text-xs">
                              <span className="text-zinc-300 font-medium w-24 truncate">{lp.botName}</span>
                              <div className="flex-1 h-3 bg-zinc-900 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${pct}%`,
                                    backgroundColor: i % 2 === 0 ? '#1ABC9C' : '#0EA5E9',
                                  }}
                                />
                              </div>
                              <span className="text-zinc-500 text-[10px] w-28 text-right">
                                Y {lp.yMin} - {lp.yMax} ({range} layers)
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {error && (
                    <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                      {error}
                    </p>
                  )}

                  {/* Start Button */}
                  <button
                    onClick={handleStartBuild}
                    disabled={selectedBots.size === 0 || starting}
                    className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-all ${
                      selectedBots.size === 0 || starting
                        ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                        : 'bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white shadow-lg shadow-teal-900/20'
                    }`}
                  >
                    {starting ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Starting Build...
                      </span>
                    ) : (
                      `Start Build with ${selectedBots.size} Bot${selectedBots.size !== 1 ? 's' : ''}`
                    )}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
