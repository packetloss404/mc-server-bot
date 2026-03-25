'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import { formatItemName, getItemCategoryColorByName, SLOT_PLACEHOLDERS } from '@/lib/items';

interface EquipmentSlot {
  name: string;
  count: number;
}

interface BotArmor {
  helmet: EquipmentSlot | null;
  chestplate: EquipmentSlot | null;
  leggings: EquipmentSlot | null;
  boots: EquipmentSlot | null;
}

interface Props {
  botName: string;
  armor: BotArmor;
  mainHand: EquipmentSlot | null;
  offhand: EquipmentSlot | null;
  accentColor: string;
}

function GearSlot({
  item,
  label,
  placeholderKey,
  delay = 0,
}: {
  item: EquipmentSlot | null;
  label: string;
  placeholderKey: string;
  delay?: number;
}) {
  const color = item ? getItemCategoryColorByName(item.name) : '#3f3f46';
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay, duration: 0.2 }}
      className="relative group"
    >
      <div
        className="w-12 h-12 rounded-lg border flex flex-col items-center justify-center gap-0.5 transition-colors"
        style={{
          backgroundColor: item ? `${color}10` : '#18181b',
          borderColor: item ? `${color}30` : '#27272a',
        }}
        title={item ? `${formatItemName(item.name)}${item.count > 1 ? ` x${item.count}` : ''}` : `Empty ${label}`}
      >
        {item ? (
          <>
            <span className="text-[8px] text-zinc-300 text-center leading-tight font-medium truncate w-full px-0.5">
              {formatItemName(item.name).split(' ').slice(-1)[0]}
            </span>
            {item.count > 1 && (
              <span className="text-[7px] font-bold text-zinc-400">{item.count}</span>
            )}
          </>
        ) : (
          <span className="text-base opacity-20">{SLOT_PLACEHOLDERS[placeholderKey] ?? ''}</span>
        )}
      </div>
      <span className="text-[8px] text-zinc-600 text-center block mt-0.5">{label}</span>

      {/* Hover tooltip */}
      {item && (
        <div className="absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[10px] text-zinc-200 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity">
          {formatItemName(item.name)}{item.count > 1 ? ` x${item.count}` : ''}
        </div>
      )}
    </motion.div>
  );
}

export function EquipmentDisplay({ botName, armor, mainHand, offhand, accentColor }: Props) {
  return (
    <div className="flex items-center gap-4">
      {/* Left: Armor column */}
      <div className="flex flex-col items-center gap-1">
        <GearSlot item={armor.helmet} label="Head" placeholderKey="helmet" delay={0} />
        <GearSlot item={armor.chestplate} label="Chest" placeholderKey="chestplate" delay={0.05} />
        <GearSlot item={armor.leggings} label="Legs" placeholderKey="leggings" delay={0.1} />
        <GearSlot item={armor.boots} label="Feet" placeholderKey="boots" delay={0.15} />
      </div>

      {/* Center: Body render */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="shrink-0 relative"
      >
        <div
          className="absolute inset-0 rounded-xl opacity-10 blur-xl"
          style={{ backgroundColor: accentColor }}
        />
        <Image
          src={`https://mc-heads.net/body/${botName}/180`}
          alt={botName}
          unoptimized
          width={140}
          height={180}
          className="w-[140px] h-auto relative pixelated"
          style={{ imageRendering: 'pixelated' }}
        />
      </motion.div>

      {/* Right: Hand slots */}
      <div className="flex flex-col items-center gap-1 justify-center">
        <GearSlot item={mainHand} label="Main" placeholderKey="mainhand" delay={0.2} />
        <GearSlot item={offhand} label="Off" placeholderKey="offhand" delay={0.25} />
      </div>
    </div>
  );
}
