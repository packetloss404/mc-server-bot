'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api, type BotDetailed } from '@/lib/api';
import { formatItemName, getItemCategoryColorByName } from '@/lib/items';
import { EquipmentDisplay } from '@/components/EquipmentDisplay';
import { getPersonalityColor } from '@/lib/constants';

interface Props {
  botName: string;
  personality: string;
}

export function BotTabInventory({ botName, personality }: Props) {
  const [bot, setBot] = useState<BotDetailed | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      api
        .getBotDetailed(botName)
        .then((data) => { setBot(data.bot); setError(null); })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Failed to load inventory';
          setError(msg);
        });
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [botName]);

  if (error && !bot) {
    return (
      <div className="bg-zinc-900/80 border border-red-500/30 rounded-xl p-4">
        <p className="text-xs text-red-400 text-center py-3">Couldn&apos;t load inventory: {error}</p>
      </div>
    );
  }
  if (!bot) {
    return (
      <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
        <p className="text-xs text-zinc-600 text-center py-3">Loading inventory...</p>
      </div>
    );
  }

  const accentColor = getPersonalityColor(personality);
  const defaultArmor = { helmet: null, chestplate: null, leggings: null, boots: null };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {/* Equipment */}
      <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Equipment</h2>
        <EquipmentDisplay
          botName={bot.name}
          armor={bot.armor ?? defaultArmor}
          mainHand={bot.equipment}
          offhand={bot.offhand ?? null}
          accentColor={accentColor}
        />
      </div>

      {/* Inventory grid */}
      <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
          Inventory ({bot.inventory.length})
        </h2>
        {/* Hotbar */}
        {bot.hotbar && bot.hotbar.some((s) => s !== null) && (
          <div className="mb-3">
            <p className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Hotbar</p>
            <div className="grid grid-cols-9 gap-0.5">
              {(bot.hotbar || Array(9).fill(null)).map((item, i) => (
                <InventorySlot key={`hb-${i}`} item={item} highlight />
              ))}
            </div>
          </div>
        )}
        {/* Main */}
        <p className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Main</p>
        <div className="grid grid-cols-9 gap-0.5">
          {Array.from({ length: 27 }).map((_, i) => {
            const item = bot.inventory.find((inv) => inv.slot === i + 9);
            return <InventorySlot key={`inv-${i}`} item={item ?? null} />;
          })}
        </div>
      </div>
    </motion.div>
  );
}

function InventorySlot({
  item,
  highlight,
}: {
  item: { name: string; count: number } | null;
  highlight?: boolean;
}) {
  const color = item ? getItemCategoryColorByName(item.name) : undefined;
  return (
    <div
      className="aspect-square rounded flex items-center justify-center relative group cursor-default"
      style={{
        backgroundColor: item ? `${color}08` : highlight ? '#1a1a1e' : '#141416',
        border: `1px solid ${item ? `${color}20` : highlight ? '#27272a' : '#1c1c1e'}`,
      }}
      title={item ? `${formatItemName(item.name)} x${item.count}` : 'Empty'}
    >
      {item && (
        <>
          <span className="text-[7px] text-zinc-400 text-center leading-tight truncate px-0.5">
            {item.name.replace(/_/g, ' ').split(' ').slice(-1)[0]}
          </span>
          {item.count > 1 && (
            <span className="absolute bottom-0 right-0.5 text-[7px] text-white font-bold">{item.count}</span>
          )}
        </>
      )}
    </div>
  );
}
