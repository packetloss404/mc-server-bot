'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { api, type RoleAssignmentRecord, type BotStatus } from '@/lib/api';
import {
  RoleAssignmentPanel,
  ROLE_COLORS,
  ROLE_ICONS,
  ROLE_DESCRIPTIONS,
  ALL_ROLES,
} from '@/components/RoleAssignmentPanel';

export default function RolesPage() {
  const [assignments, setAssignments] = useState<RoleAssignmentRecord[]>([]);
  const [bots, setBots] = useState<BotStatus[]>([]);
  const [editingBot, setEditingBot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [assignData, botData] = await Promise.all([
        api.getRoleAssignments(),
        api.getBots(),
      ]);
      setAssignments(assignData.assignments);
      setBots(botData.bots);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 8000);
    return () => clearInterval(interval);
  }, [loadData]);

  const assignedBotNames = new Set(assignments.map((a) => a.botName));
  const unassignedBots = bots.filter((b) => !assignedBotNames.has(b.name));
  const assignmentsByBot = Object.fromEntries(assignments.map((a) => [a.botName, a]));

  const handleSave = () => {
    setEditingBot(null);
    loadData();
  };

  const handleDelete = async (botName: string) => {
    try {
      await api.deleteRoleAssignment(botName);
      loadData();
    } catch {
      // ignore
    }
  };

  // Count bots per role
  const roleCounts: Record<string, number> = {};
  for (const a of assignments) {
    roleCounts[a.role] = (roleCounts[a.role] || 0) + 1;
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-zinc-500">Loading roles...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Role Assignments</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Manage bot roles, autonomy levels, and operational zones
        </p>
      </div>

      {/* Role catalog */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Role Catalog</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {ALL_ROLES.map((role) => {
            const color = ROLE_COLORS[role];
            const count = roleCounts[role] || 0;
            return (
              <div
                key={role}
                className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4 hover:border-zinc-700/60 transition-colors"
              >
                <div className="flex items-center gap-2.5 mb-2">
                  <span
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-base"
                    style={{ backgroundColor: `${color}15` }}
                  >
                    {ROLE_ICONS[role]}
                  </span>
                  <div>
                    <h3 className="text-xs font-semibold capitalize" style={{ color }}>
                      {role.replace('-', ' ')}
                    </h3>
                    <span className="text-[10px] text-zinc-600">
                      {count} bot{count !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  {ROLE_DESCRIPTIONS[role]}
                </p>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Editing panel */}
      {editingBot && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <RoleAssignmentPanel
            botName={editingBot}
            existingAssignment={assignmentsByBot[editingBot]}
            onSave={handleSave}
            onCancel={() => setEditingBot(null)}
          />
        </motion.div>
      )}

      {/* Assignment table */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-zinc-800/40">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            Assigned Bots ({assignments.length})
          </h2>
        </div>

        {assignments.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-xs text-zinc-600">No role assignments yet. Assign roles to bots below.</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/40">
            {assignments.map((a) => {
              const color = ROLE_COLORS[a.role] || '#6B7280';
              return (
                <div key={a.botName} className="px-5 py-3 flex items-center gap-4 hover:bg-zinc-800/20 transition-colors">
                  {/* Bot name */}
                  <div className="flex items-center gap-2.5 min-w-[140px]">
                    <img
                      src={`https://mc-heads.net/avatar/${a.botName}/20`}
                      alt=""
                      className="w-5 h-5 rounded pixelated shrink-0"
                      style={{ imageRendering: 'pixelated' }}
                    />
                    <span className="text-sm text-white font-medium">{a.botName}</span>
                  </div>

                  {/* Role badge */}
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium capitalize"
                    style={{ color, backgroundColor: `${color}12`, border: `1px solid ${color}25` }}
                  >
                    <span>{ROLE_ICONS[a.role] || ''}</span>
                    {a.role.replace('-', ' ')}
                  </span>

                  {/* Autonomy */}
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded capitalize ${
                    a.autonomyLevel === 'autonomous' ? 'text-emerald-400 bg-emerald-500/10' :
                    a.autonomyLevel === 'assisted' ? 'text-amber-400 bg-amber-500/10' :
                    'text-zinc-400 bg-zinc-700/30'
                  }`}>
                    {a.autonomyLevel}
                  </span>

                  {/* Home marker */}
                  {a.homeMarkerId && (
                    <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      </svg>
                      {a.homeMarkerId}
                    </span>
                  )}

                  {/* Zones */}
                  {a.allowedZoneIds && a.allowedZoneIds.length > 0 && (
                    <div className="flex items-center gap-1">
                      {a.allowedZoneIds.map((z: string) => (
                        <span key={z} className="text-[10px] text-zinc-500 bg-zinc-800/60 px-1.5 py-0.5 rounded">
                          {z}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Actions */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setEditingBot(editingBot === a.botName ? null : a.botName)}
                      className="text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded text-[11px] font-medium transition-colors hover:bg-zinc-800/40"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(a.botName)}
                      className="text-zinc-600 hover:text-red-400 px-2 py-1 rounded text-[11px] font-medium transition-colors hover:bg-red-500/5"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Unassigned bots */}
      {unassignedBots.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-zinc-800/40">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Unassigned Bots ({unassignedBots.length})
            </h2>
          </div>
          <div className="divide-y divide-zinc-800/40">
            {unassignedBots.map((bot) => (
              <div key={bot.name} className="px-5 py-3 flex items-center gap-4 hover:bg-zinc-800/20 transition-colors">
                <div className="flex items-center gap-2.5 min-w-[140px]">
                  <img
                    src={`https://mc-heads.net/avatar/${bot.name}/20`}
                    alt=""
                    className="w-5 h-5 rounded pixelated shrink-0"
                    style={{ imageRendering: 'pixelated' }}
                  />
                  <span className="text-sm text-white font-medium">{bot.name}</span>
                </div>
                <span className="text-[11px] text-zinc-600 capitalize">{bot.personality}</span>
                <span className="text-[11px] text-zinc-600">{bot.state}</span>
                <div className="flex-1" />
                <button
                  onClick={() => setEditingBot(bot.name)}
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
                >
                  Assign Role
                </button>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
