'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { Zone, Route, Marker, Mission } from '@/lib/api';

// ── Zone detail panel ────────────────────────────────────
interface ZoneDetailProps {
  zone: Zone;
  missions: Mission[];
  botNames: string[];
  selectedBotIds: string[];
  onCreateMission: (type: string, botName: string, zoneId: string) => void;
}

export function ZoneDetailPanel({ zone, missions, botNames, selectedBotIds, onCreateMission }: ZoneDetailProps) {
  const [missionType, setMissionType] = useState<'guard' | 'patrol' | 'farm' | 'mine'>('guard');
  const [targetBot, setTargetBot] = useState<string>(selectedBotIds[0] || botNames[0] || '');
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  const activeMissions = missions.filter(
    (m) => m.zoneId === zone.id && ['pending', 'active'].includes(m.status),
  );

  const handleCreate = () => {
    if (!targetBot) return;
    onCreateMission(missionType, targetBot, zone.id);
    setFeedback({ msg: `Mission created for ${targetBot}`, ok: true });
    setTimeout(() => setFeedback(null), 3000);
  };

  const typeColor = ZONE_TYPE_COLORS[zone.type] || '#6B7280';

  return (
    <div className="border-t border-zinc-800/60 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: typeColor }} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-zinc-200 truncate">{zone.name}</p>
          <p className="text-[9px] text-zinc-500 capitalize">{zone.type} zone</p>
        </div>
      </div>

      {/* Active missions on this zone */}
      {activeMissions.length > 0 && (
        <div className="mb-2">
          <p className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Active Missions</p>
          {activeMissions.map((m) => (
            <div key={m.id} className="flex items-center gap-1.5 text-[10px] text-zinc-400 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="truncate">{m.botName}: {m.type}</span>
            </div>
          ))}
        </div>
      )}

      {/* Assigned bots */}
      {zone.assignedBots && zone.assignedBots.length > 0 && (
        <div className="mb-2">
          <p className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Assigned</p>
          <div className="flex flex-wrap gap-1">
            {zone.assignedBots.map((b) => (
              <span key={b} className="text-[9px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">{b}</span>
            ))}
          </div>
        </div>
      )}

      {/* Create Mission */}
      <div className="bg-zinc-800/50 rounded-lg p-2 space-y-2">
        <p className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider">Create Mission</p>

        <div className="flex gap-1">
          {(['guard', 'patrol', 'farm', 'mine'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setMissionType(t)}
              className={`flex-1 text-[9px] py-1 rounded capitalize transition-colors ${
                missionType === t
                  ? 'bg-zinc-700 text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-400'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <select
          value={targetBot}
          onChange={(e) => setTargetBot(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-700/50 rounded px-2 py-1 text-[10px] text-zinc-300"
        >
          {botNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
          {botNames.length === 0 && <option value="" disabled>No bots available</option>}
        </select>

        <button
          onClick={handleCreate}
          disabled={!targetBot}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-[10px] font-medium py-1.5 rounded transition-colors"
        >
          Assign Mission
        </button>

        {feedback && (
          <p className={`text-[9px] ${feedback.ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {feedback.msg}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Route detail panel ────────────────────────────────────
interface RouteDetailProps {
  route: Route;
  botNames: string[];
  selectedBotIds: string[];
  onAssignPatrol: (botName: string, routeId: string) => void;
}

export function RouteDetailPanel({ route, botNames, selectedBotIds, onAssignPatrol }: RouteDetailProps) {
  const [targetBot, setTargetBot] = useState<string>(selectedBotIds[0] || botNames[0] || '');
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  const handleAssign = () => {
    if (!targetBot) return;
    onAssignPatrol(targetBot, route.id);
    setFeedback({ msg: `Patrol assigned to ${targetBot}`, ok: true });
    setTimeout(() => setFeedback(null), 3000);
  };

  return (
    <div className="border-t border-zinc-800/60 p-3">
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="#A78BFA" strokeWidth="1.5">
          <polyline points="2,12 6,4 10,10 14,3" />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-zinc-200 truncate">{route.name}</p>
          <p className="text-[9px] text-zinc-500">{route.waypoints.length} waypoints{route.loop ? ' (loop)' : ''}</p>
        </div>
      </div>

      {route.assignedBots && route.assignedBots.length > 0 && (
        <div className="mb-2">
          <p className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Patrolling</p>
          <div className="flex flex-wrap gap-1">
            {route.assignedBots.map((b) => (
              <span key={b} className="text-[9px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">{b}</span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-zinc-800/50 rounded-lg p-2 space-y-2">
        <p className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider">Assign Patrol</p>
        <select
          value={targetBot}
          onChange={(e) => setTargetBot(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-700/50 rounded px-2 py-1 text-[10px] text-zinc-300"
        >
          {botNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <button
          onClick={handleAssign}
          disabled={!targetBot}
          className="w-full bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-[10px] font-medium py-1.5 rounded transition-colors"
        >
          Start Patrol
        </button>
        {feedback && (
          <p className={`text-[9px] ${feedback.ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {feedback.msg}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Marker detail panel ────────────────────────────────────
interface MarkerDetailProps {
  marker: Marker;
  selectedBotIds: string[];
  botNames: string[];
  onSendBots: (botNames: string[], x: number, z: number) => void;
}

export function MarkerDetailPanel({ marker, selectedBotIds, botNames, onSendBots }: MarkerDetailProps) {
  const botsToSend = selectedBotIds.length > 0 ? selectedBotIds : botNames.slice(0, 1);

  return (
    <div className="border-t border-zinc-800/60 p-3">
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="#F59E0B" strokeWidth="1.5">
          <path d="M8 1C5.2 1 3 3.2 3 6c0 4 5 9 5 9s5-5 5-9c0-2.8-2.2-5-5-5z" />
          <circle cx="8" cy="6" r="1.5" fill="#F59E0B" />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-zinc-200 truncate">{marker.name}</p>
          <p className="text-[9px] text-zinc-500 font-mono">{Math.round(marker.x)}, {Math.round(marker.z)}</p>
        </div>
      </div>

      <button
        onClick={() => onSendBots(botsToSend, marker.x, marker.z)}
        disabled={botsToSend.length === 0}
        className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-[10px] font-medium py-1.5 rounded transition-colors"
      >
        Send {botsToSend.length > 0 ? botsToSend.join(', ') : 'bots'} here
      </button>
    </div>
  );
}

// ── Colors ────────────────────────────────────
export const ZONE_TYPE_COLORS: Record<string, string> = {
  guard: '#4A90D9',
  build: '#1ABC9C',
  farm: '#F39C12',
  mine: '#D97706',
  custom: '#8B5CF6',
};
