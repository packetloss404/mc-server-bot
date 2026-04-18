'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, SchematicInfo, MissionRecord, Campaign } from '@/lib/api';
import { useBotStore, useCampaignStore, useSchematicPlacementStore } from '@/lib/store';
import { SchematicMiniMap } from '@/components/build/SchematicMiniMap';
import { CampaignStatus } from '@/components/build/CampaignStatus';
import { PageHeader } from '@/components/PageHeader';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PERSONALITIES = ['builder', 'merchant', 'guard', 'elder', 'explorer', 'blacksmith', 'farmer'];

function getRecommendation(blockCount: number) {
  const BLOCKS_PER_BOT_15MIN = 3600; // 4 blocks/sec x 60 x 15
  const raw = Math.ceil(blockCount / BLOCKS_PER_BOT_15MIN);
  const count = Math.max(1, Math.min(5, raw));
  const estimatedMinutes = Math.ceil(blockCount / (count * 4) / 60);
  const reasoning = blockCount <= BLOCKS_PER_BOT_15MIN
    ? 'Small build -- one bot is sufficient'
    : `${blockCount.toLocaleString()} blocks at ~15 min target`;
  return { count, estimatedMinutes, reasoning };
}

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

const MISSION_STATUS_COLORS: Record<string, string> = {
  draft: '#6B7280',
  queued: '#F59E0B',
  running: '#1ABC9C',
  paused: '#F59E0B',
  completed: '#10B981',
  failed: '#EF4444',
  cancelled: '#6B7280',
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

function MissionStatusBadge({ status }: { status: string }) {
  const color = MISSION_STATUS_COLORS[status] ?? '#6B7280';
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
  const [botMode, setBotMode] = useState<'existing' | 'create'>('existing');
  const [namePrefix, setNamePrefix] = useState('Builder');
  const [botCount, setBotCount] = useState(1);
  const [createdBotNames, setCreatedBotNames] = useState<string[]>([]);
  const [personality, setPersonality] = useState('builder');
  const [createProgress, setCreateProgress] = useState('');
  const [buildMission, setBuildMission] = useState<MissionRecord | null>(null);
  const [fillFoundation, setFillFoundation] = useState(true);
  const [snapToGround, setSnapToGround] = useState(false);
  const [groundInfo, setGroundInfo] = useState<{ y: number; block: string } | null>(null);
  const [groundLoading, setGroundLoading] = useState(false);

  const botList = useBotStore((s) => s.botList);
  const playerList = useBotStore((s) => s.playerList);
  const activeBuild = useBotStore((s) => s.activeBuild);
  const setActiveBuild = useBotStore((s) => s.setActiveBuild);
  const campaigns = useCampaignStore((s) => s.campaigns);

  // Campaign queuing state
  const [campaignName, setCampaignName] = useState('');
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [addingToCampaign, setAddingToCampaign] = useState(false);
  const [startingCampaignId, setStartingCampaignId] = useState<string | null>(null);

  const activeCampaigns = useMemo(
    () => campaigns.filter((c) => c.status === 'pending' || c.status === 'running' || c.status === 'paused'),
    [campaigns],
  );

  const currentCampaign = useMemo<Campaign | null>(() => {
    if (!campaignName.trim()) return null;
    return (
      campaigns.find(
        (c) => c.name.toLowerCase() === campaignName.trim().toLowerCase(),
      ) || null
    );
  }, [campaigns, campaignName]);

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

  const recommendation = useMemo(() => {
    if (!selectedSchematic) return null;
    return getRecommendation(selectedSchematic.blockCount);
  }, [selectedSchematic]);

  useEffect(() => {
    if (recommendation) setBotCount(recommendation.count);
  }, [recommendation]);

  const effectiveBotNames = useMemo(() => {
    if (botMode === 'existing') return Array.from(selectedBots);
    return Array.from({ length: botCount }, (_, i) => `${namePrefix}${i + 1}`);
  }, [botMode, selectedBots, botCount, namePrefix]);

  const estimatedMinutes = useMemo(() => {
    if (!selectedSchematic || effectiveBotNames.length === 0) return 0;
    return Math.ceil(selectedSchematic.blockCount / (effectiveBotNames.length * 4) / 60);
  }, [selectedSchematic, effectiveBotNames]);

  // Fetch ground height at current origin
  const fetchGroundHeight = useCallback((x: number, z: number) => {
    setGroundLoading(true);
    api.getTerrainHeight(x, z)
      .then((data) => setGroundInfo({ y: data.y, block: data.block }))
      .catch(() => setGroundInfo(null))
      .finally(() => setGroundLoading(false));
  }, []);

  // Auto-fetch ground height when origin X/Z changes
  useEffect(() => {
    if (!selectedSchematic) return;
    const timer = setTimeout(() => fetchGroundHeight(origin.x, origin.z), 400);
    return () => clearTimeout(timer);
  }, [origin.x, origin.z, selectedSchematic, fetchGroundHeight]);

  const handleSnapToGround = async () => {
    setGroundLoading(true);
    try {
      const data = await api.getTerrainHeight(origin.x, origin.z);
      setGroundInfo({ y: data.y, block: data.block });
      setOrigin((prev) => ({ ...prev, y: data.y + 1 }));
    } catch {
      setError('Failed to fetch ground height');
    } finally {
      setGroundLoading(false);
    }
  };

  const toggleBot = (name: string) => {
    setSelectedBots((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const layerPreview = useMemo(() => {
    if (!selectedSchematic || effectiveBotNames.length === 0) return [];
    const totalY = selectedSchematic.size.y;
    const layersPerBot = Math.ceil(totalY / effectiveBotNames.length);
    return effectiveBotNames.map((name, i) => ({
      botName: name,
      yMin: i * layersPerBot,
      yMax: Math.min((i + 1) * layersPerBot - 1, totalY - 1),
    }));
  }, [selectedSchematic, effectiveBotNames]);

  const handleStartBuild = async () => {
    if (!selectedSchematic) return;
    setStarting(true);
    setError(null);
    setCreateProgress('');
    setBuildMission(null);

    try {
      let botNames: string[];

      if (botMode === 'existing') {
        if (selectedBots.size === 0) return;
        botNames = Array.from(selectedBots);
      } else {
        botNames = Array.from({ length: botCount }, (_, i) => `${namePrefix}${i + 1}`);

        // Create bots sequentially
        for (let i = 0; i < botNames.length; i++) {
          setCreateProgress(`Creating ${botNames[i]}... (${i + 1}/${botNames.length})`);
          try {
            await api.createBot(botNames[i], personality, 'codegen');
          } catch (err: unknown) {
            // Bot might already exist -- that's ok
            if (!(err instanceof Error) || !err.message.includes('already exists')) throw err;
          }
          if (i < botNames.length - 1) await delay(5000);
        }

        // Wait for bots to connect
        setCreateProgress('Waiting for bots to connect...');
        const startTime = Date.now();
        const TIMEOUT = 90_000;

        while (Date.now() - startTime < TIMEOUT) {
          await delay(2000);
          const { bots } = await api.getBots();
          const created = bots.filter((b) => botNames.includes(b.name));
          const connected = created.filter(
            (b) => b.state !== 'DISCONNECTED' && b.state !== 'SPAWNING',
          );
          setCreateProgress(`Waiting for bots... (${connected.length}/${botNames.length} connected)`);
          if (connected.length === botNames.length) break;
        }

        // Use whatever connected
        const { bots: finalBots } = await api.getBots();
        const ready = finalBots
          .filter((b) => botNames.includes(b.name))
          .filter((b) => b.state !== 'DISCONNECTED' && b.state !== 'SPAWNING');
        if (ready.length === 0) throw new Error('No bots connected within 90 seconds');
        botNames = ready.map((b) => b.name);
      }

      // Track which bots were created for this build
      if (botMode === 'create') setCreatedBotNames(botNames);

      setCreateProgress('Starting build...');
      const cleanupBotNames = botMode === 'create' ? botNames : undefined;
      const result = await api.startBuild(selectedSchematic.filename, origin, botNames, cleanupBotNames, { fillFoundation, snapToGround });
      setActiveBuild(result.build);

      // Create a mission to track this build
      const schematicName = selectedSchematic.filename.replace(/\.(schem|schematic)$/i, '');
      try {
        const missionResult = await api.createMission({
          type: 'build_schematic',
          title: `Build: ${schematicName}`,
          description: `Building ${schematicName} at (${origin.x}, ${origin.y}, ${origin.z}) with ${botNames.length} bot(s). ${selectedSchematic.blockCount.toLocaleString()} blocks total.`,
          assigneeType: 'bot',
          assigneeIds: botNames,
          priority: 'normal',
          source: 'dashboard',
        });
        setBuildMission(missionResult.mission);
      } catch {
        // Mission creation is best-effort; build continues regardless
      }

      setSelectedSchematic(null);
      setSelectedBots(new Set());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start build');
    } finally {
      setStarting(false);
      setCreateProgress('');
    }
  };

  const handleCancel = async () => {
    if (!activeBuild) return;
    try {
      await api.cancelBuild(activeBuild.id);
      // Delete bots that were created for this build
      if (createdBotNames.length > 0) {
        for (const name of createdBotNames) {
          try { await api.deleteBot(name); } catch {}
        }
        setCreatedBotNames([]);
      }
      if (buildMission) {
        try { await api.cancelMission(buildMission.id); } catch {}
        setBuildMission(null);
      }
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

  const handleAddToCampaign = async () => {
    if (!selectedSchematic) return;
    const name = campaignName.trim();
    if (!name) return;
    setCampaignError(null);
    setAddingToCampaign(true);
    try {
      const newStructure = {
        schematicFile: selectedSchematic.filename,
        origin: { ...origin },
        botCountHint: effectiveBotNames.length || botCount,
      };
      if (currentCampaign) {
        // MVP: backend has no "add structure" endpoint, so delete + recreate.
        // Only safe for pending campaigns (running campaigns would be disrupted).
        if (currentCampaign.status !== 'pending') {
          throw new Error(`Campaign "${currentCampaign.name}" is ${currentCampaign.status}; can only add to pending campaigns.`);
        }
        const appendedStructures = [
          ...currentCampaign.structures.map((s) => ({
            schematicFile: s.schematicFile,
            origin: s.origin,
            botCountHint: s.botCountHint,
          })),
          newStructure,
        ];
        await api.deleteCampaign(currentCampaign.id);
        await api.createCampaign({
          name: currentCampaign.name,
          structures: appendedStructures,
          maxParallel: currentCampaign.maxParallel,
          autoSpawn: currentCampaign.autoSpawn,
          spawnPersonality: currentCampaign.spawnPersonality,
          cleanupBots: currentCampaign.cleanupBots,
          start: false,
        });
      } else {
        await api.createCampaign({
          name,
          structures: [newStructure],
          start: false,
        });
      }
    } catch (err: unknown) {
      setCampaignError(err instanceof Error ? err.message : 'Failed to add to campaign');
    } finally {
      setAddingToCampaign(false);
    }
  };

  const handleStartCampaign = async (id: string) => {
    setStartingCampaignId(id);
    setCampaignError(null);
    try {
      await api.startCampaign(id);
    } catch (err: unknown) {
      setCampaignError(err instanceof Error ? err.message : 'Failed to start campaign');
    } finally {
      setStartingCampaignId(null);
    }
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

      {/* Active Campaigns */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-white">Active Campaigns</h2>
        <CampaignStatus />
      </div>

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

            {/* Mission Status */}
            {buildMission && (
              <div className="flex items-center gap-3 bg-zinc-800/40 rounded-lg px-3 py-2">
                <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Mission</span>
                <span className="text-xs text-zinc-300 font-medium">{buildMission.title}</span>
                <MissionStatusBadge status={buildMission.status} />
              </div>
            )}

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
                const placed = assignment.blocksPlaced ?? 0;
                const total = assignment.blocksTotal ?? 0;
                const botPct = total > 0 ? Math.round((placed / total) * 100) : 0;
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
                    <ProgressBar value={placed} max={total} color="#0EA5E9" />
                    <div className="text-[10px] text-zinc-500 text-right">
                      {placed} / {total} ({botPct}%)
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
                      <button
                        onClick={handleSnapToGround}
                        disabled={groundLoading}
                        className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[10px] font-medium bg-zinc-800/60 border border-zinc-700/40 text-zinc-400 hover:text-amber-300 hover:border-amber-500/40 transition-all disabled:opacity-40"
                        title="Set Y to ground level + 1 at this X/Z position"
                      >
                        {groundLoading ? (
                          <div className="w-3 h-3 border border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
                        ) : (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 19V5" />
                            <path d="M5 12l7 7 7-7" />
                          </svg>
                        )}
                        Snap to Ground
                      </button>
                    </div>
                    {/* Ground height indicator */}
                    {groundInfo && (
                      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-medium border ${
                        (() => {
                          const delta = origin.y - groundInfo.y;
                          if (delta < 0) return 'bg-red-500/10 border-red-500/30 text-red-400';
                          if (delta > 10) return 'bg-red-500/10 border-red-500/30 text-red-400';
                          if (delta > 2) return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
                          return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
                        })()
                      }`}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 22h20" />
                          <path d="M6 18V2" />
                          <path d="M18 18V8" />
                          <path d="M12 18V12" />
                        </svg>
                        Ground at Y={groundInfo.y} ({groundInfo.block})
                        {' '}&mdash; Building {origin.y - groundInfo.y < 0
                          ? `${Math.abs(origin.y - groundInfo.y)} blocks underground`
                          : `${origin.y - groundInfo.y} block${origin.y - groundInfo.y !== 1 ? 's' : ''} above ground`}
                      </div>
                    )}
                    {/* Footprint summary */}
                    {selectedSchematic && (
                      <p className="text-[10px] text-zinc-500 mt-1">
                        Footprint: <span className="text-zinc-400">{selectedSchematic.size.x} x {selectedSchematic.size.z}</span> blocks,{' '}
                        <span className="text-zinc-400">{selectedSchematic.size.y}</span> tall
                        {' '}&mdash; from <span className="text-zinc-400 font-mono">({origin.x}, {origin.y}, {origin.z})</span>
                        {' '}to <span className="text-zinc-400 font-mono">({origin.x + selectedSchematic.size.x}, {origin.y + selectedSchematic.size.y}, {origin.z + selectedSchematic.size.z})</span>
                      </p>
                    )}
                    {/* Use player/bot position */}
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {playerList.filter((p) => p.isOnline && p.position).map((player) => (
                        <button
                          key={player.name}
                          onClick={() => {
                            const pos = { x: Math.floor(player.position!.x), y: Math.floor(player.position!.y), z: Math.floor(player.position!.z) };
                            setOrigin(pos);
                            fetchGroundHeight(pos.x, pos.z);
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium bg-zinc-800/60 border border-zinc-700/40 text-zinc-400 hover:text-cyan-300 hover:border-cyan-500/40 transition-all"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                            <circle cx="12" cy="10" r="3" />
                          </svg>
                          {player.name}
                        </button>
                      ))}
                      {connectedBots.map((bot) => bot.position && (
                        <button
                          key={bot.name}
                          onClick={() => {
                            const pos = { x: Math.floor(bot.position!.x), y: Math.floor(bot.position!.y), z: Math.floor(bot.position!.z) };
                            setOrigin(pos);
                            fetchGroundHeight(pos.x, pos.z);
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium bg-zinc-800/60 border border-zinc-700/40 text-zinc-400 hover:text-teal-300 hover:border-teal-500/40 transition-all"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <circle cx="12" cy="10" r="3" />
                            <path d="M7 21v-2a4 4 0 014-4h2a4 4 0 014 4v2" />
                          </svg>
                          {bot.name}
                        </button>
                      ))}
                    </div>
                    {/* Pick on Map mini-map */}
                    {selectedSchematic && (
                      <MiniMapSection schematic={selectedSchematic} origin={origin} setOrigin={setOrigin} onOriginPicked={fetchGroundHeight} />
                    )}
                  </div>

                  {/* Bot Selector -- Tabbed */}
                  <div className="space-y-3">
                    <label className="text-xs text-zinc-400 font-medium">Assign Bots</label>
                    <div className="flex gap-2">
                      {(['existing', 'create'] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setBotMode(mode)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            botMode === mode
                              ? 'bg-teal-500/15 border border-teal-500/40 text-teal-300'
                              : 'bg-zinc-800/60 border border-zinc-700/40 text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          {mode === 'existing' ? 'Use Existing Bots' : 'Create Bots for Task'}
                        </button>
                      ))}
                    </div>

                    {botMode === 'existing' ? (
                      connectedBots.length === 0 ? (
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
                      )
                    ) : (
                      <div className="space-y-4">
                        {/* AI Recommendation */}
                        {recommendation && (
                          <div className="bg-teal-500/10 border border-teal-500/30 rounded-lg p-3 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1ABC9C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                </svg>
                                <span className="text-xs font-semibold text-teal-300">
                                  Recommended: {recommendation.count} bot{recommendation.count !== 1 ? 's' : ''}
                                </span>
                              </div>
                              {botCount !== recommendation.count && (
                                <button
                                  onClick={() => setBotCount(recommendation.count)}
                                  className="text-[10px] text-teal-400 hover:text-teal-300 font-medium"
                                >
                                  Use Recommended
                                </button>
                              )}
                            </div>
                            <p className="text-[11px] text-zinc-500">{recommendation.reasoning}</p>
                          </div>
                        )}

                        {/* Name Prefix */}
                        <div className="flex items-center gap-4">
                          <div className="flex-1 space-y-1">
                            <label className="text-[10px] text-zinc-600 uppercase font-bold">Name Prefix</label>
                            <input
                              type="text"
                              value={namePrefix}
                              onChange={(e) => setNamePrefix(e.target.value.replace(/\s/g, ''))}
                              placeholder="Builder"
                              className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-zinc-600 uppercase font-bold">Personality</label>
                            <select
                              value={personality}
                              onChange={(e) => setPersonality(e.target.value)}
                              className="bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white"
                            >
                              {PERSONALITIES.map((p) => (
                                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Bot Count Stepper */}
                        <div className="space-y-1">
                          <label className="text-[10px] text-zinc-600 uppercase font-bold">Bot Count</label>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setBotCount((c) => Math.max(1, c - 1))}
                              disabled={botCount <= 1}
                              className="w-8 h-8 rounded-lg bg-zinc-800/60 border border-zinc-700/40 text-zinc-400 hover:text-white hover:border-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-sm font-bold"
                            >
                              -
                            </button>
                            <span className="text-lg font-bold text-white w-8 text-center">{botCount}</span>
                            <button
                              onClick={() => setBotCount((c) => Math.min(5, c + 1))}
                              disabled={botCount >= 5}
                              className="w-8 h-8 rounded-lg bg-zinc-800/60 border border-zinc-700/40 text-zinc-400 hover:text-white hover:border-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-sm font-bold"
                            >
                              +
                            </button>
                            <span className="text-xs text-zinc-500 ml-2">
                              ~{estimatedMinutes} min estimated
                            </span>
                          </div>
                        </div>

                        {/* Name Preview */}
                        <p className="text-[11px] text-zinc-500">
                          Will create: {effectiveBotNames.join(', ')}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Build Options */}
                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 font-medium">Build Options</label>
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 cursor-pointer group" title="Fill gaps under the build with stone to prevent floating">
                        <span
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                            fillFoundation ? 'border-teal-500 bg-teal-500' : 'border-zinc-600 group-hover:border-zinc-500'
                          }`}
                          onClick={() => setFillFoundation((v) => !v)}
                        >
                          {fillFoundation && (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </span>
                        <span className="text-xs text-zinc-300" onClick={() => setFillFoundation((v) => !v)}>
                          Fill Foundation
                        </span>
                        <span className="text-[10px] text-zinc-600" onClick={() => setFillFoundation((v) => !v)}>
                          Fill gaps under the build with stone
                        </span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer group" title="Auto-adjust Y to average ground level under the footprint">
                        <span
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                            snapToGround ? 'border-teal-500 bg-teal-500' : 'border-zinc-600 group-hover:border-zinc-500'
                          }`}
                          onClick={() => setSnapToGround((v) => !v)}
                        >
                          {snapToGround && (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </span>
                        <span className="text-xs text-zinc-300" onClick={() => setSnapToGround((v) => !v)}>
                          Snap to Ground
                        </span>
                        <span className="text-[10px] text-zinc-600" onClick={() => setSnapToGround((v) => !v)}>
                          Auto-adjust Y to average ground level
                        </span>
                      </label>
                    </div>
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

                  {/* Queue to Campaign */}
                  <div className="space-y-2 border-t border-zinc-800/60 pt-4">
                    <label className="text-xs text-zinc-400 font-medium">Queue to Campaign</label>
                    <p className="text-[11px] text-zinc-500">
                      Add this structure to a campaign, then start the whole town at once.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={campaignName}
                        onChange={(e) => setCampaignName(e.target.value)}
                        placeholder="Campaign name (e.g. Oakridge)"
                        list="existing-campaigns"
                        className="flex-1 min-w-[180px] bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white"
                      />
                      <datalist id="existing-campaigns">
                        {activeCampaigns.map((c) => (
                          <option key={c.id} value={c.name} />
                        ))}
                      </datalist>
                      <button
                        onClick={handleAddToCampaign}
                        disabled={!campaignName.trim() || addingToCampaign || !selectedSchematic}
                        className="px-3 py-2 rounded-lg text-xs font-medium bg-zinc-800/80 border border-zinc-700/50 text-zinc-300 hover:text-white hover:border-teal-500/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {addingToCampaign ? 'Adding...' : 'Add to Campaign'}
                      </button>
                      {currentCampaign && (
                        <button
                          onClick={() => handleStartCampaign(currentCampaign.id)}
                          disabled={
                            startingCampaignId === currentCampaign.id ||
                            currentCampaign.status !== 'pending' ||
                            currentCampaign.structures.length === 0
                          }
                          className="px-3 py-2 rounded-lg text-xs font-semibold bg-teal-600/20 border border-teal-500/40 text-teal-300 hover:bg-teal-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {startingCampaignId === currentCampaign.id ? 'Starting...' : 'Start Campaign'}
                        </button>
                      )}
                    </div>
                    {currentCampaign && (
                      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                        <span className="px-2 py-0.5 rounded-full bg-zinc-800/80 border border-zinc-700/50 text-zinc-300 font-medium">
                          {currentCampaign.structures.length} structure{currentCampaign.structures.length !== 1 ? 's' : ''} queued
                        </span>
                        <span>in &quot;{currentCampaign.name}&quot; ({currentCampaign.status})</span>
                      </div>
                    )}
                    {!currentCampaign && campaignName.trim() && (
                      <p className="text-[11px] text-zinc-500">
                        Will create new campaign &quot;{campaignName.trim()}&quot;.
                      </p>
                    )}
                    {campaignError && (
                      <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                        {campaignError}
                      </p>
                    )}
                  </div>

                  {/* Start Button */}
                  {(() => {
                    const canStart = botMode === 'existing'
                      ? selectedBots.size > 0
                      : namePrefix.trim().length > 0 && botCount > 0;
                    const buttonLabel = botMode === 'existing'
                      ? `Start Build with ${selectedBots.size} Bot${selectedBots.size !== 1 ? 's' : ''}`
                      : `Create ${botCount} Bot${botCount !== 1 ? 's' : ''} & Start Build`;
                    return (
                      <button
                        onClick={handleStartBuild}
                        disabled={!canStart || starting}
                        className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-all ${
                          !canStart || starting
                            ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                            : 'bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white shadow-lg shadow-teal-900/20'
                        }`}
                      >
                        {starting ? (
                          <span className="flex items-center justify-center gap-2">
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            {createProgress || 'Starting Build...'}
                          </span>
                        ) : (
                          buttonLabel
                        )}
                      </button>
                    );
                  })()}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

function MiniMapSection({ schematic, origin, setOrigin, onOriginPicked }: { schematic: SchematicInfo; origin: { x: number; y: number; z: number }; setOrigin: (o: { x: number; y: number; z: number }) => void; onOriginPicked?: (x: number, z: number) => void }) {
  const [showMap, setShowMap] = useState(false);

  return (
    <div className="mt-2">
      <button
        onClick={() => {
          setShowMap((v) => !v);
          if (!showMap) {
            useSchematicPlacementStore.getState().startPlacement({
              filename: schematic.filename,
              sizeX: schematic.size.x,
              sizeZ: schematic.size.z,
              sizeY: schematic.size.y,
            });
          } else {
            useSchematicPlacementStore.getState().cancelPlacement();
          }
        }}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${
          showMap
            ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
            : 'bg-zinc-800/60 border-zinc-700/40 text-zinc-400 hover:text-blue-300 hover:border-blue-500/40'
        }`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" />
          <path d="M8 2v16" />
          <path d="M16 6v16" />
        </svg>
        {showMap ? 'Hide Map' : 'Pick on Map'}
      </button>
      <AnimatePresence>
        {showMap && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mt-2"
          >
            <SchematicMiniMap
              schematic={schematic}
              origin={origin}
              onOriginChange={(o) => { setOrigin(o); onOriginPicked?.(o.x, o.z); }}
              height={300}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
