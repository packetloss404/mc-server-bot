'use client';

import { useState } from 'react';
import { useMapOverlayStore } from '@/lib/mapStore';
import { useBotStore } from '@/lib/store';
import { api } from '@/lib/api';

export function MapContextMenu() {
  const contextMenu = useMapOverlayStore((s) => s.contextMenu);
  const closeContextMenu = useMapOverlayStore((s) => s.closeContextMenu);
  const zones = useMapOverlayStore((s) => s.zones);
  const routes = useMapOverlayStore((s) => s.routes);
  const addMarker = useMapOverlayStore((s) => s.addMarker);
  const bots = useBotStore((s) => s.botList);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!contextMenu) return null;

  const { screenX, screenY, worldX, worldZ } = contextMenu;
  const onlineBots = bots.filter((b) => b.state !== 'DISCONNECTED');

  // Find zone at the right-click point
  const zoneAtPoint = zones.find(
    (z) => worldX >= z.x1 && worldX <= z.x2 && worldZ >= z.z1 && worldZ <= z.z2,
  );

  // Find nearest route
  const nearestRoute = routes.length > 0 ? routes[0] : null;

  const handleSendBotsHere = async () => {
    if (onlineBots.length === 0) return;
    const rx = Math.round(worldX);
    const rz = Math.round(worldZ);
    let succeeded = 0;
    for (const bot of onlineBots) {
      try {
        await api.walkTo(bot.name, rx, null, rz);
        succeeded++;
      } catch {
        // Continue with remaining bots
      }
    }
    setFeedback(`Sent ${succeeded}/${onlineBots.length} bots to (${rx}, ${rz})`);
    setTimeout(() => { setFeedback(null); closeContextMenu(); }, 1500);
  };

  const handleGuardZone = async () => {
    if (!zoneAtPoint || onlineBots.length === 0) return;
    let succeeded = 0;
    for (const bot of onlineBots) {
      try {
        await api.createCommand({
          type: 'guard',
          botName: bot.name,
          params: { zoneId: zoneAtPoint.id, zoneName: zoneAtPoint.name },
        });
        succeeded++;
      } catch {
        // Continue
      }
    }
    setFeedback(`Guard command sent to ${succeeded} bot(s) for "${zoneAtPoint.name}"`);
    setTimeout(() => { setFeedback(null); closeContextMenu(); }, 1500);
  };

  const handlePatrolRoute = async () => {
    if (!nearestRoute || onlineBots.length === 0) return;
    let succeeded = 0;
    for (const bot of onlineBots) {
      try {
        await api.createCommand({
          type: 'patrol',
          botName: bot.name,
          params: { routeId: nearestRoute.id, routeName: nearestRoute.name },
        });
        succeeded++;
      } catch {
        // Continue
      }
    }
    setFeedback(`Patrol command sent to ${succeeded} bot(s) for "${nearestRoute.name}"`);
    setTimeout(() => { setFeedback(null); closeContextMenu(); }, 1500);
  };

  const handlePlaceMarker = async () => {
    const name = prompt('Marker name:');
    if (!name?.trim()) return;
    try {
      const result = await api.createMarker({
        name: name.trim(),
        x: Math.round(worldX),
        y: 64,
        z: Math.round(worldZ),
      });
      addMarker(result.marker);
      closeContextMenu();
    } catch {
      setFeedback('Failed to place marker');
      setTimeout(() => { setFeedback(null); closeContextMenu(); }, 1500);
    }
  };

  return (
    <>
      {/* Backdrop to close */}
      <div className="absolute inset-0 z-40" onClick={closeContextMenu} />

      {/* Menu */}
      <div
        className="absolute z-50 bg-zinc-900/95 border border-zinc-700/60 rounded-lg shadow-2xl backdrop-blur-sm py-1 min-w-[180px]"
        style={{ left: screenX, top: screenY }}
      >
        {feedback ? (
          <div className="px-3 py-2 text-[11px] text-emerald-400">{feedback}</div>
        ) : (
          <>
            <div className="px-3 py-1.5 text-[9px] font-mono text-zinc-600 border-b border-zinc-800/60">
              ({Math.round(worldX)}, {Math.round(worldZ)})
            </div>

            <MenuItem
              label={`Send all bots here (${onlineBots.length})`}
              icon=">"
              disabled={onlineBots.length === 0}
              onClick={handleSendBotsHere}
            />

            {zoneAtPoint && (
              <MenuItem
                label={`Guard "${zoneAtPoint.name}"`}
                icon="S"
                disabled={onlineBots.length === 0}
                onClick={handleGuardZone}
              />
            )}

            {nearestRoute && (
              <MenuItem
                label={`Patrol "${nearestRoute.name}"`}
                icon="P"
                disabled={onlineBots.length === 0}
                onClick={handlePatrolRoute}
              />
            )}

            <div className="border-t border-zinc-800/60 my-1" />

            <MenuItem label="Place marker" icon="+" onClick={handlePlaceMarker} />
          </>
        )}
      </div>
    </>
  );
}

function MenuItem({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors ${
        disabled
          ? 'text-zinc-700 cursor-not-allowed'
          : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
      }`}
    >
      <span className="w-4 text-center text-[10px] text-zinc-600 font-mono">{icon}</span>
      {label}
    </button>
  );
}
