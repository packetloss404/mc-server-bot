'use client';

import { useState, useEffect } from 'react';
import { api, type RoleAssignmentRecord, type MarkerRecord, type ZoneRecord } from '@/lib/api';

export const ROLE_COLORS: Record<string, string> = {
  guard: '#EF4444',
  builder: '#3B82F6',
  hauler: '#F59E0B',
  farmer: '#10B981',
  miner: '#6B7280',
  scout: '#8B5CF6',
  merchant: '#EC4899',
  'free-agent': '#6B7280',
};

export const ROLE_ICONS: Record<string, string> = {
  guard: '\u{1F6E1}',
  builder: '\u{1F528}',
  hauler: '\u{1F4E6}',
  farmer: '\u{1F33E}',
  miner: '\u{26CF}',
  scout: '\u{1F9ED}',
  merchant: '\u{1F4B0}',
  'free-agent': '\u{1F464}',
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  guard: 'Patrols and defends areas from hostile mobs',
  builder: 'Constructs structures from blueprints',
  hauler: 'Transports items between locations',
  farmer: 'Plants, harvests, and manages crops',
  miner: 'Excavates resources underground',
  scout: 'Explores and maps new terrain',
  merchant: 'Trades items with players and other bots',
  'free-agent': 'No assigned role, available for tasks',
};

export const ALL_ROLES = Object.keys(ROLE_COLORS);

const AUTONOMY_LEVELS = [
  { value: 'manual' as const, label: 'Manual', description: 'Requires explicit commands for every action' },
  { value: 'assisted' as const, label: 'Assisted', description: 'Suggests actions, waits for approval' },
  { value: 'autonomous' as const, label: 'Autonomous', description: 'Acts independently within role scope' },
];

const INTERRUPT_POLICIES = [
  { value: 'always' as const, label: 'Always', description: 'Allow role work to replace existing activity.' },
  { value: 'confirm-if-busy' as const, label: 'Confirm if busy', description: 'Prefer assisted behavior when another task is active.' },
  { value: 'never-while-critical' as const, label: 'Never while critical', description: 'Do not replace critical/running work automatically.' },
];

interface RoleAssignmentPanelProps {
  botName: string;
  existingAssignment?: RoleAssignmentRecord;
  onSave: () => void;
  onCancel: () => void;
}

export function RoleAssignmentPanel({ botName, existingAssignment, onSave, onCancel }: RoleAssignmentPanelProps) {
  const [role, setRole] = useState(existingAssignment?.role || 'free-agent');
  const [autonomy, setAutonomy] = useState<'manual' | 'assisted' | 'autonomous'>(existingAssignment?.autonomyLevel || 'assisted');
  const [homeMarker, setHomeMarker] = useState(existingAssignment?.homeMarkerId || '');
  const [allowedZones, setAllowedZones] = useState<string[]>(existingAssignment?.allowedZoneIds || []);
  const [interruptPolicy, setInterruptPolicy] = useState<'always' | 'confirm-if-busy' | 'never-while-critical'>(existingAssignment?.interruptPolicy || 'confirm-if-busy');
  const [preferredMissionTypes, setPreferredMissionTypes] = useState<string>(existingAssignment?.preferredMissionTypes?.join(', ') || '');
  const [markers, setMarkers] = useState<MarkerRecord[]>([]);
  const [zones, setZones] = useState<ZoneRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getMarkers().then((d) => setMarkers(d.markers)).catch(() => {});
    api.getZones().then((d) => setZones(d.zones)).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Partial<RoleAssignmentRecord> = {
        botName,
        role,
        autonomyLevel: autonomy,
        homeMarkerId: homeMarker || undefined,
        allowedZoneIds: allowedZones.length > 0 ? allowedZones : [],
        interruptPolicy,
        preferredMissionTypes: preferredMissionTypes.split(',').map((value) => value.trim()).filter(Boolean),
      };
      if (existingAssignment) {
        await api.updateRoleAssignment(existingAssignment.id, payload);
      } else {
        await api.createRoleAssignment(payload);
      }
      onSave();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save assignment');
    } finally {
      setSaving(false);
    }
  };

  const toggleZone = (zoneId: string) => {
    setAllowedZones((prev) =>
      prev.includes(zoneId) ? prev.filter((z) => z !== zoneId) : [...prev, zoneId]
    );
  };

  return (
    <div className="bg-zinc-900/90 border border-zinc-800/60 rounded-xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">
          {existingAssignment ? 'Edit' : 'Assign'} Role - {botName}
        </h3>
        <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Role selector */}
      <div>
        <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2 block">Role</label>
        <div className="grid grid-cols-4 gap-1.5">
          {ALL_ROLES.map((r) => {
            const color = ROLE_COLORS[r];
            const active = role === r;
            return (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-[11px] font-medium transition-all border ${
                  active
                    ? 'border-opacity-50 bg-opacity-10'
                    : 'border-zinc-800/60 hover:border-zinc-700/60 bg-transparent'
                }`}
                style={active ? { borderColor: `${color}60`, backgroundColor: `${color}10`, color } : { color: '#a1a1aa' }}
              >
                <span className="text-base">{ROLE_ICONS[r]}</span>
                <span className="capitalize">{r.replace('-', ' ')}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Autonomy level */}
      <div>
        <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2 block">Autonomy Level</label>
        <div className="space-y-1.5">
          {AUTONOMY_LEVELS.map((level) => (
            <button
              key={level.value}
              onClick={() => setAutonomy(level.value)}
              className={`w-full text-left px-3 py-2 rounded-lg border transition-all ${
                autonomy === level.value
                  ? 'border-emerald-500/40 bg-emerald-500/5'
                  : 'border-zinc-800/60 hover:border-zinc-700/60'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${autonomy === level.value ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
                <span className={`text-xs font-medium ${autonomy === level.value ? 'text-emerald-400' : 'text-zinc-400'}`}>
                  {level.label}
                </span>
              </div>
              <p className="text-[10px] text-zinc-600 ml-4">{level.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Home marker */}
      <div>
        <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2 block">Home Marker</label>
        <select
          value={homeMarker}
          onChange={(e) => setHomeMarker(e.target.value)}
          className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white appearance-none cursor-pointer"
        >
          <option value="">None</option>
          {markers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({Math.round(m.position.x)}, {Math.round(m.position.y)}, {Math.round(m.position.z)})
            </option>
          ))}
        </select>
      </div>

      {/* Allowed zones */}
      {zones.length > 0 && (
        <div>
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2 block">Allowed Zones</label>
          <div className="flex flex-wrap gap-1.5">
            {zones.map((z) => {
              const selected = allowedZones.includes(z.id);
              return (
                <button
                  key={z.id}
                  onClick={() => toggleZone(z.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all border ${
                    selected
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                      : 'border-zinc-800/60 text-zinc-500 hover:border-zinc-700/60 hover:text-zinc-400'
                  }`}
                >
                  {z.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2 block">Interrupt Policy</label>
        <div className="space-y-1.5">
          {INTERRUPT_POLICIES.map((policy) => (
            <button
              key={policy.value}
              onClick={() => setInterruptPolicy(policy.value)}
              className={`w-full text-left px-3 py-2 rounded-lg border transition-all ${
                interruptPolicy === policy.value
                  ? 'border-cyan-500/40 bg-cyan-500/5'
                  : 'border-zinc-800/60 hover:border-zinc-700/60'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${interruptPolicy === policy.value ? 'bg-cyan-400' : 'bg-zinc-700'}`} />
                <span className={`text-xs font-medium ${interruptPolicy === policy.value ? 'text-cyan-400' : 'text-zinc-400'}`}>
                  {policy.label}
                </span>
              </div>
              <p className="text-[10px] text-zinc-600 ml-4">{policy.description}</p>
            </button>
          ))}
        </div>
      </div>

      {autonomy === 'assisted' && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <p className="text-[11px] font-semibold text-amber-300">Approval behavior</p>
          <p className="text-[10px] text-zinc-500 mt-1">
            Assisted bots do not auto-start role work. They create approval cards on the Roles page for review.
          </p>
        </div>
      )}

      <div>
        <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2 block">Preferred Mission Types</label>
        <input
          value={preferredMissionTypes}
          onChange={(e) => setPreferredMissionTypes(e.target.value)}
          placeholder="queue_task, patrol_zone"
          className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white"
        />
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/40">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors"
        >
          {saving ? 'Saving...' : existingAssignment ? 'Update Assignment' : 'Assign Role'}
        </button>
        <button
          onClick={onCancel}
          className="text-zinc-500 hover:text-zinc-300 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
