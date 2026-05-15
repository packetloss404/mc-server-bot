'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMapOverlayStore } from '@/lib/mapStore';
import { useBotStore } from '@/lib/store';
import { api } from '@/lib/api';

interface Props {
  /** Lowercase bot names currently marquee-selected on the map. */
  selectedBotNames?: string[];
  /** Called when the user picks "Follow this bot". */
  onFollow?: (botName: string) => void;
  /** Called when the user picks "Set build origin here". */
  onSetBuildOrigin?: (x: number, z: number) => void;
}

export function MapContextMenu({
  selectedBotNames = [],
  onFollow,
  onSetBuildOrigin,
}: Props) {
  const router = useRouter();
  const contextMenu = useMapOverlayStore((s) => s.contextMenu);
  const closeContextMenu = useMapOverlayStore((s) => s.closeContextMenu);
  const zones = useMapOverlayStore((s) => s.zones);
  const routes = useMapOverlayStore((s) => s.routes);
  const markers = useMapOverlayStore((s) => s.markers);
  const addMarker = useMapOverlayStore((s) => s.addMarker);
  const removeMarker = useMapOverlayStore((s) => s.removeMarker);
  const bots = useBotStore((s) => s.botList);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!contextMenu) return null;

  const { screenX, screenY, worldX, worldZ, botName, markerId } = contextMenu;
  const onlineBots = bots.filter((b) => b.state !== 'DISCONNECTED');

  // Find zone at the right-click point
  const zoneAtPoint = zones.find(
    (z) => worldX >= z.x1 && worldX <= z.x2 && worldZ >= z.z1 && worldZ <= z.z2,
  );

  // Find nearest route
  const nearestRoute = routes.length > 0 ? routes[0] : null;

  // Marker context
  const targetMarker = markerId ? markers.find((m) => m.id === markerId) : null;

  // Selected-bot list (live, filtered by online state)
  const selectedOnline = onlineBots.filter((b) =>
    selectedBotNames.includes(b.name.toLowerCase()),
  );

  const flash = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => {
      setFeedback(null);
      closeContextMenu();
    }, 1500);
  };

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
    flash(`Sent ${succeeded}/${onlineBots.length} bots to (${rx}, ${rz})`);
  };

  const handleSendSelectedBotsHere = async () => {
    if (selectedOnline.length === 0) return;
    const rx = Math.round(worldX);
    const rz = Math.round(worldZ);
    let succeeded = 0;
    for (const bot of selectedOnline) {
      try {
        await api.walkTo(bot.name, rx, null, rz);
        succeeded++;
      } catch {
        // Continue
      }
    }
    flash(`Sent ${succeeded}/${selectedOnline.length} selected to (${rx}, ${rz})`);
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
    flash(`Guard command sent to ${succeeded} bot(s) for "${zoneAtPoint.name}"`);
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
    flash(`Patrol command sent to ${succeeded} bot(s) for "${nearestRoute.name}"`);
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
      flash('Failed to place marker');
    }
  };

  const handleSetBuildOrigin = () => {
    onSetBuildOrigin?.(Math.round(worldX), Math.round(worldZ));
    closeContextMenu();
  };

  const handleFollowBot = () => {
    if (!botName) return;
    onFollow?.(botName);
    closeContextMenu();
  };

  const handleOpenBotDetail = () => {
    if (!botName) return;
    router.push(`/bots/${encodeURIComponent(botName)}`);
    closeContextMenu();
  };

  const handleEditMarker = () => {
    if (!targetMarker) return;
    const name = prompt('Rename marker:', targetMarker.name);
    if (!name?.trim() || name.trim() === targetMarker.name) {
      closeContextMenu();
      return;
    }
    // The API doesn't expose a marker-update endpoint as of this turn, so we
    // delete-and-recreate to keep behaviour predictable.
    (async () => {
      try {
        await api.deleteMarker(targetMarker.id);
        removeMarker(targetMarker.id);
        const result = await api.createMarker({
          name: name.trim(),
          x: targetMarker.x,
          y: targetMarker.y,
          z: targetMarker.z,
        });
        addMarker(result.marker);
        closeContextMenu();
      } catch {
        flash('Failed to rename marker');
      }
    })();
  };

  const handleDeleteMarker = async () => {
    if (!targetMarker) return;
    try {
      await api.deleteMarker(targetMarker.id);
      removeMarker(targetMarker.id);
      closeContextMenu();
    } catch {
      flash('Failed to delete marker');
    }
  };

  // Determine which menu variant to show.
  const variant: 'bot' | 'marker' | 'map' = botName
    ? 'bot'
    : targetMarker
    ? 'marker'
    : 'map';

  return (
    <>
      {/* Backdrop to close */}
      <div className="absolute inset-0 z-40" onClick={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }} />

      {/* Menu */}
      <div
        className="absolute z-50 bg-zinc-900/95 border border-zinc-700/60 rounded-lg shadow-2xl backdrop-blur-sm py-1 min-w-[200px]"
        style={{ left: screenX, top: screenY }}
      >
        {feedback ? (
          <div className="px-3 py-2 text-[11px] text-emerald-400">{feedback}</div>
        ) : (
          <>
            <div className="px-3 py-1.5 text-[9px] font-mono text-zinc-600 border-b border-zinc-800/60">
              {variant === 'bot' && botName ? `bot: ${botName}` : null}
              {variant === 'marker' && targetMarker ? `marker: ${targetMarker.name}` : null}
              {variant === 'map' ? `(${Math.round(worldX)}, ${Math.round(worldZ)})` : null}
            </div>

            {variant === 'bot' && (
              <>
                <MenuItem label="Follow this bot" icon="@" onClick={handleFollowBot} />
                <MenuItem label="Open detail page" icon=">" onClick={handleOpenBotDetail} />
                <div className="border-t border-zinc-800/60 my-1" />
                <MenuItem
                  label={`Send selected here (${selectedOnline.length})`}
                  icon="*"
                  disabled={selectedOnline.length === 0}
                  onClick={handleSendSelectedBotsHere}
                />
              </>
            )}

            {variant === 'marker' && (
              <>
                <MenuItem label="Edit marker" icon="e" onClick={handleEditMarker} />
                <MenuItem label="Delete marker" icon="x" onClick={handleDeleteMarker} />
              </>
            )}

            {variant === 'map' && (
              <>
                <MenuItem
                  label="Set build origin here"
                  icon="o"
                  disabled={!onSetBuildOrigin}
                  onClick={handleSetBuildOrigin}
                />
                <MenuItem label="Drop waypoint here" icon="+" onClick={handlePlaceMarker} />
                <MenuItem
                  label={`Send selected bots here (${selectedOnline.length})`}
                  icon="*"
                  disabled={selectedOnline.length === 0}
                  onClick={handleSendSelectedBotsHere}
                />

                <div className="border-t border-zinc-800/60 my-1" />

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
              </>
            )}
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
