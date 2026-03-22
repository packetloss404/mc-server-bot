// Item classification and display utilities

type ItemCategory = 'armor' | 'weapon' | 'tool' | 'food' | 'block' | 'material' | 'other';

const CATEGORY_COLORS: Record<ItemCategory, string> = {
  armor: '#60A5FA',
  weapon: '#EF4444',
  tool: '#F59E0B',
  food: '#10B981',
  block: '#8B5CF6',
  material: '#A78BFA',
  other: '#6B7280',
};

const ARMOR_KEYWORDS = ['helmet', 'chestplate', 'leggings', 'boots', 'shield', 'elytra', 'turtle_shell'];
const WEAPON_KEYWORDS = ['sword', 'bow', 'crossbow', 'trident', 'mace'];
const TOOL_KEYWORDS = ['pickaxe', 'axe', 'shovel', 'hoe', 'shears', 'fishing_rod', 'flint_and_steel', 'spyglass', 'compass', 'clock', 'map', 'lead', 'brush'];
const FOOD_KEYWORDS = ['apple', 'bread', 'beef', 'pork', 'chicken', 'mutton', 'rabbit', 'cod', 'salmon', 'potato', 'carrot', 'beetroot', 'melon_slice', 'sweet_berries', 'glow_berries', 'cookie', 'pie', 'cake', 'stew', 'soup', 'golden_apple', 'enchanted_golden_apple', 'chorus_fruit', 'dried_kelp'];
const BLOCK_KEYWORDS = ['log', 'planks', 'stone', 'cobblestone', 'dirt', 'sand', 'gravel', 'brick', 'glass', 'wool', 'concrete', 'terracotta', 'ore', 'deepslate', 'stairs', 'slab', 'fence', 'wall', 'door', 'trapdoor', 'torch', 'lantern', 'chest', 'barrel', 'furnace', 'crafting_table', 'anvil', 'bed', 'leaves'];

export function getItemCategory(name: string): ItemCategory {
  const n = name.toLowerCase();
  if (ARMOR_KEYWORDS.some((k) => n.includes(k))) return 'armor';
  if (WEAPON_KEYWORDS.some((k) => n.includes(k))) return 'weapon';
  if (TOOL_KEYWORDS.some((k) => n.includes(k))) return 'tool';
  if (FOOD_KEYWORDS.some((k) => n === k || n === `cooked_${k}`)) return 'food';
  if (BLOCK_KEYWORDS.some((k) => n.includes(k))) return 'block';
  if (['stick', 'string', 'leather', 'iron_ingot', 'gold_ingot', 'diamond', 'emerald', 'coal', 'redstone', 'lapis_lazuli', 'quartz', 'amethyst_shard', 'copper_ingot', 'netherite_ingot', 'bone', 'feather', 'gunpowder', 'blaze_rod', 'ender_pearl', 'ghast_tear', 'slime_ball', 'paper', 'book', 'ink_sac', 'dye'].some((k) => n.includes(k))) return 'material';
  return 'other';
}

export function getItemCategoryColor(category: ItemCategory): string {
  return CATEGORY_COLORS[category];
}

export function getItemCategoryColorByName(name: string): string {
  return CATEGORY_COLORS[getItemCategory(name)];
}

export function formatItemName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const ITEM_EMOJIS: Record<string, string> = {
  // Armor
  helmet: '\u{1F6E1}',
  chestplate: '\u{1F6E1}',
  leggings: '\u{1F6E1}',
  boots: '\u{1F6E1}',
  shield: '\u{1F6E1}',
  elytra: '\u{1F985}',
  // Weapons
  sword: '\u{2694}',
  bow: '\u{1F3F9}',
  crossbow: '\u{1F3F9}',
  trident: '\u{1F531}',
  // Tools
  pickaxe: '\u{26CF}',
  axe: '\u{1FA93}',
  shovel: '\u{1F528}',
  hoe: '\u{1F33E}',
  shears: '\u{2702}',
  fishing_rod: '\u{1F3A3}',
  // Food
  apple: '\u{1F34E}',
  bread: '\u{1F35E}',
  beef: '\u{1F356}',
  pork: '\u{1F356}',
  chicken: '\u{1F357}',
  carrot: '\u{1F955}',
  potato: '\u{1F954}',
  melon: '\u{1F349}',
  cookie: '\u{1F36A}',
  cake: '\u{1F370}',
  // Materials
  diamond: '\u{1F48E}',
  emerald: '\u{1F48E}',
  coal: '\u{26AB}',
  iron_ingot: '\u{1F4A0}',
  gold_ingot: '\u{1F4B0}',
  stick: '\u{1F4CF}',
  bone: '\u{1F9B4}',
  // Blocks
  torch: '\u{1F525}',
  chest: '\u{1F4E6}',
};

export function getItemEmoji(name: string): string {
  const n = name.toLowerCase();
  for (const [key, emoji] of Object.entries(ITEM_EMOJIS)) {
    if (n.includes(key)) return emoji;
  }
  return '';
}

// Slot placeholder icons for empty armor/equipment slots
export const SLOT_PLACEHOLDERS: Record<string, string> = {
  helmet: '\u{1F451}',
  chestplate: '\u{1F455}',
  leggings: '\u{1F456}',
  boots: '\u{1F462}',
  mainhand: '\u{270B}',
  offhand: '\u{1F91A}',
};
