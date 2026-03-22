'use client';

import { motion } from 'framer-motion';
import { getBlockColor } from '@/lib/blockColors';

const HOSTILE_MOBS = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'phantom', 'drowned', 'husk', 'stray', 'blaze', 'ghast', 'magma_cube', 'slime', 'pillager', 'vindicator', 'ravager', 'vex', 'evoker', 'warden', 'guardian', 'elder_guardian', 'piglin_brute', 'hoglin', 'wither_skeleton', 'shulker'];
const PASSIVE_MOBS = ['cow', 'pig', 'sheep', 'chicken', 'horse', 'donkey', 'mule', 'cat', 'dog', 'wolf', 'rabbit', 'fox', 'bee', 'turtle', 'dolphin', 'squid', 'parrot', 'villager', 'iron_golem', 'snow_golem', 'axolotl', 'frog', 'goat', 'camel', 'sniffer', 'bat', 'mooshroom', 'llama', 'panda', 'ocelot', 'strider', 'trader_llama', 'wandering_trader'];

function classifyEntity(name: string): 'hostile' | 'player' | 'passive' {
  const n = name.toLowerCase();
  if (n.startsWith('player:') || n.startsWith('player_')) return 'player';
  if (HOSTILE_MOBS.some((m) => n.includes(m))) return 'hostile';
  if (PASSIVE_MOBS.some((m) => n.includes(m))) return 'passive';
  // Default to hostile for unknown entities (safer assumption)
  return 'hostile';
}

const ENTITY_COLORS = {
  hostile: '#EF4444',
  player: '#60A5FA',
  passive: '#10B981',
};

interface Props {
  nearbyEntities: string;
  nearbyBlocks: string;
  biome: string;
  timeOfDay: string;
  isRaining: boolean;
}

export function WorldContext({ nearbyEntities, nearbyBlocks, biome, timeOfDay, isRaining }: Props) {
  // Parse entities: "zombie (5m), player:Steve (12m), cow (8m)"
  const entities = nearbyEntities
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'none')
    .map((s) => {
      const match = s.match(/^(.+?)(?:\s*\((\d+)m?\))?$/);
      if (!match) return { name: s, distance: null, type: classifyEntity(s) };
      return {
        name: match[1].trim(),
        distance: match[2] ? parseInt(match[2]) : null,
        type: classifyEntity(match[1].trim()),
      };
    });

  // Parse blocks: "dirt, grass_block, stone, oak_log"
  const blocks = nearbyBlocks
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'none visible');

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4 space-y-4"
    >
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">World</h2>

      {/* Environment info */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
        <span className="capitalize">{biome}</span>
        <span className="capitalize">{timeOfDay}</span>
        <span>{isRaining ? 'Raining' : 'Clear'}</span>
      </div>

      {/* Nearby entities */}
      {entities.length > 0 && (
        <div>
          <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1.5">
            Nearby ({entities.length})
          </p>
          <div className="space-y-1">
            {entities.map((entity, i) => {
              const color = ENTITY_COLORS[entity.type];
              const displayName = entity.name.replace('player:', '');
              return (
                <div key={`${entity.name}-${i}`} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                    <span style={{ color }}>{displayName}</span>
                  </div>
                  {entity.distance !== null && (
                    <span className="text-[10px] text-zinc-600 tabular-nums">{entity.distance}m</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Nearby blocks */}
      {blocks.length > 0 && (
        <div>
          <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1.5">Blocks</p>
          <div className="flex flex-wrap gap-1">
            {blocks.map((block, i) => (
              <span
                key={`${block}-${i}`}
                className="text-[10px] px-1.5 py-0.5 rounded border"
                style={{
                  color: getBlockColor(block),
                  borderColor: `${getBlockColor(block)}30`,
                  backgroundColor: `${getBlockColor(block)}08`,
                }}
              >
                {block.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
