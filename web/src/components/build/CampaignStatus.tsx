'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { api, Campaign, CampaignStructure, CampaignStructureStatus, CampaignStatus as CampaignStatusT } from '@/lib/api';
import { useBuildStore, useCampaignStore } from '@/lib/store';

const STRUCTURE_STATUS_COLORS: Record<CampaignStructureStatus, string> = {
  pending: '#6B7280',
  building: '#0EA5E9',
  completed: '#10B981',
  failed: '#EF4444',
  cancelled: '#F59E0B',
};

const CAMPAIGN_STATUS_COLORS: Record<CampaignStatusT, string> = {
  pending: '#6B7280',
  running: '#1ABC9C',
  completed: '#10B981',
  failed: '#EF4444',
  cancelled: '#EF4444',
  paused: '#F59E0B',
};

function StructureStatusPill({ status }: { status: CampaignStructureStatus }) {
  const color = STRUCTURE_STATUS_COLORS[status] ?? '#6B7280';
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

function CampaignStatusBadge({ status }: { status: CampaignStatusT }) {
  const color = CAMPAIGN_STATUS_COLORS[status] ?? '#6B7280';
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

function ProgressBar({ value, max, color = '#1ABC9C', thin = false }: { value: number; max: number; color?: string; thin?: boolean }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className={`w-full ${thin ? 'h-1' : 'h-2'} bg-zinc-800 rounded-full overflow-hidden`}>
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

function StructureCard({ structure }: { structure: CampaignStructure }) {
  const builds = useBuildStore((s) => s.builds);
  const build = structure.buildJobId ? builds.find((b) => b.id === structure.buildJobId) : null;
  const placed = build?.placedBlocks ?? 0;
  const total = build?.totalBlocks ?? 0;
  const color = STRUCTURE_STATUS_COLORS[structure.status] ?? '#6B7280';
  const displayName = structure.schematicFile.replace(/\.(schem|schematic)$/i, '');

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-zinc-800/50 border border-zinc-700/40 rounded-lg p-3 space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-white truncate" title={structure.schematicFile}>
          {displayName}
        </span>
        <StructureStatusPill status={structure.status} />
      </div>
      <div className="text-[10px] text-zinc-500 font-mono">
        ({structure.origin.x}, {structure.origin.y}, {structure.origin.z})
      </div>
      {structure.buildJobId && total > 0 && (
        <div className="space-y-1">
          <ProgressBar value={placed} max={total} color={color} thin />
          <div className="text-[10px] text-zinc-500 text-right">
            {placed.toLocaleString()} / {total.toLocaleString()}
          </div>
        </div>
      )}
      {structure.error && (
        <p className="text-[10px] text-red-400 truncate" title={structure.error}>
          {structure.error}
        </p>
      )}
    </motion.div>
  );
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const completedCount = campaign.structures.filter((s) => s.status === 'completed').length;
  const totalCount = campaign.structures.length;
  const overallPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const isPending = campaign.status === 'pending';
  const isRunning = campaign.status === 'running';
  const isPaused = campaign.status === 'paused';
  const isTerminal = campaign.status === 'completed' || campaign.status === 'failed' || campaign.status === 'cancelled';

  const handleStart = async () => {
    try { await api.startCampaign(campaign.id); } catch {}
  };
  const handlePause = async () => {
    try { await api.pauseCampaign(campaign.id); } catch {}
  };
  const handleResume = async () => {
    try { await api.resumeCampaign(campaign.id); } catch {}
  };
  const handleCancel = async () => {
    try { await api.cancelCampaign(campaign.id); } catch {}
  };
  const handleDelete = async () => {
    try { await api.deleteCampaign(campaign.id); } catch {}
  };

  return (
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
              <path d="M3 21h18" />
              <path d="M5 21V7l8-4v18" />
              <path d="M19 21V11l-6-4" />
              <path d="M9 9v.01" />
              <path d="M9 12v.01" />
              <path d="M9 15v.01" />
              <path d="M9 18v.01" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">{campaign.name}</h2>
            <p className="text-[11px] text-zinc-500">
              {completedCount} / {totalCount} structures complete
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CampaignStatusBadge status={campaign.status} />
          {isPending && (
            <button
              onClick={handleStart}
              className="px-3 py-1.5 bg-teal-600/20 hover:bg-teal-600/30 text-teal-400 text-xs font-medium rounded-lg transition-colors"
            >
              Start
            </button>
          )}
          {isRunning && (
            <button
              onClick={handlePause}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors"
            >
              Pause
            </button>
          )}
          {isPaused && (
            <button
              onClick={handleResume}
              className="px-3 py-1.5 bg-teal-600/20 hover:bg-teal-600/30 text-teal-400 text-xs font-medium rounded-lg transition-colors"
            >
              Resume
            </button>
          )}
          {(isRunning || isPaused || isPending) && (
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium rounded-lg transition-colors"
            >
              Cancel
            </button>
          )}
          {isTerminal && (
            <button
              onClick={handleDelete}
              className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium rounded-lg transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400">Town Progress</span>
          <span className="text-white font-medium">
            {completedCount} / {totalCount} ({overallPct}%)
          </span>
        </div>
        <ProgressBar value={completedCount} max={totalCount} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {campaign.structures.map((structure) => (
          <StructureCard key={structure.id} structure={structure} />
        ))}
      </div>
    </motion.div>
  );
}

export function CampaignStatus() {
  const campaigns = useCampaignStore((s) => s.campaigns);

  if (campaigns.length === 0) {
    return (
      <div className="text-center py-8 bg-zinc-900/50 rounded-xl border border-zinc-800/40">
        <p className="text-sm text-zinc-500">No campaigns yet &mdash; queue a town from the Build page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AnimatePresence>
        {campaigns.map((campaign) => (
          <CampaignCard key={campaign.id} campaign={campaign} />
        ))}
      </AnimatePresence>
    </div>
  );
}
