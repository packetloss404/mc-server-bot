// Minecraft block name → map color (top-down view)
// Colors chosen to match typical Minecraft map rendering
const BLOCK_COLORS: Record<string, string> = {
  // Terrain
  grass_block: '#5B8C33',
  dirt: '#8B6B47',
  coarse_dirt: '#6B5035',
  rooted_dirt: '#7A5F3F',
  podzol: '#5A3D1E',
  mycelium: '#6B5F6B',
  mud: '#3C3228',
  clay: '#9EA4B0',
  gravel: '#7F7F7F',
  sand: '#DBCFA0',
  red_sand: '#A05A2C',
  sandstone: '#D4C990',
  red_sandstone: '#A04020',

  // Stone types
  stone: '#7F7F7F',
  cobblestone: '#6B6B6B',
  mossy_cobblestone: '#5B7B4B',
  deepslate: '#4A4A4A',
  tuff: '#646556',
  granite: '#9A6C50',
  diorite: '#BFBFBF',
  andesite: '#7F7F7F',
  calcite: '#D9D9D9',
  dripstone_block: '#7A6B5A',
  smooth_stone: '#8A8A8A',

  // Ores (surface-visible ones)
  coal_ore: '#636363',
  iron_ore: '#8A7C6B',
  copper_ore: '#7B6544',
  gold_ore: '#8A8240',
  diamond_ore: '#5CBCB8',
  emerald_ore: '#4AB54A',
  lapis_ore: '#3A5BAC',
  redstone_ore: '#8B2020',

  // Wood & logs
  oak_log: '#6B5030',
  spruce_log: '#3D2B18',
  birch_log: '#C8B77E',
  jungle_log: '#554020',
  acacia_log: '#6B4830',
  dark_oak_log: '#3D2B15',
  mangrove_log: '#5A3020',
  cherry_log: '#8B4050',
  oak_planks: '#AF8F55',
  spruce_planks: '#6B5030',
  birch_planks: '#C8B77E',
  jungle_planks: '#A07840',
  acacia_planks: '#A85830',
  dark_oak_planks: '#3D2B15',

  // Leaves
  oak_leaves: '#3B7A1A',
  spruce_leaves: '#2E5E2E',
  birch_leaves: '#5A8C2E',
  jungle_leaves: '#2E8C18',
  acacia_leaves: '#4A8A20',
  dark_oak_leaves: '#2E6A18',
  azalea_leaves: '#4E8E38',
  mangrove_leaves: '#3A7A2A',
  cherry_leaves: '#E8A0B0',

  // Water & ice
  water: '#3366CC',
  flowing_water: '#3366CC',
  ice: '#8CB4FC',
  packed_ice: '#7BA4EC',
  blue_ice: '#6B94DC',
  frosted_ice: '#9BC4FC',

  // Lava
  lava: '#CC4400',
  flowing_lava: '#CC4400',
  magma_block: '#8B2800',

  // Snow
  snow: '#F0F0F0',
  snow_block: '#F0F0F0',
  powder_snow: '#E8E8E8',

  // Vegetation
  short_grass: '#5B8C33',
  tall_grass: '#5B8C33',
  fern: '#4A7A2A',
  dead_bush: '#8B6B47',
  seagrass: '#2E6B40',
  kelp: '#2E6B40',
  lily_pad: '#1E6B20',
  sugar_cane: '#6BAA40',
  bamboo: '#5B8A20',
  cactus: '#3B6B20',
  vine: '#3B7A1A',
  moss_block: '#4A8028',
  moss_carpet: '#4A8028',

  // Flowers
  dandelion: '#FFEC3D',
  poppy: '#E03030',
  blue_orchid: '#30A0E0',
  allium: '#B060E0',
  azure_bluet: '#E0E0E0',
  cornflower: '#4070E0',
  lily_of_the_valley: '#E8E8E8',
  sunflower: '#FFCC00',

  // Crops
  wheat: '#D4AA40',
  carrots: '#E09030',
  potatoes: '#6B8B40',
  beetroots: '#8B2030',
  melon: '#6B8B30',
  pumpkin: '#CC8020',
  hay_block: '#B09030',

  // Nether
  netherrack: '#6B2020',
  nether_bricks: '#3D1E1E',
  soul_sand: '#4A3828',
  soul_soil: '#4A3828',
  basalt: '#4A4A4A',
  blackstone: '#2A2A2E',
  crimson_nylium: '#8B2040',
  warped_nylium: '#206B6B',
  glowstone: '#E0C060',
  shroomlight: '#E0A030',

  // End
  end_stone: '#D8D8A0',
  end_stone_bricks: '#D0D090',
  purpur_block: '#A060B0',
  obsidian: '#1A0A2E',

  // Building blocks
  bricks: '#8B5040',
  stone_bricks: '#6B6B6B',
  mossy_stone_bricks: '#5B7B4B',
  prismarine: '#5B9B8B',
  dark_prismarine: '#305B50',
  terracotta: '#985838',
  white_terracotta: '#C8A880',
  orange_terracotta: '#A05828',
  brown_terracotta: '#5A3820',
  red_terracotta: '#8B3828',
  yellow_terracotta: '#B88838',
  green_terracotta: '#5A6830',
  cyan_terracotta: '#5A6868',
  blue_terracotta: '#48506B',
  purple_terracotta: '#6B4060',
  light_blue_terracotta: '#6B7888',
  magenta_terracotta: '#8B4860',
  lime_terracotta: '#5B7020',
  pink_terracotta: '#9B5858',
  gray_terracotta: '#3D3232',
  light_gray_terracotta: '#7B6B60',
  black_terracotta: '#252020',

  // Concrete
  white_concrete: '#CFD5D6',
  black_concrete: '#080A0F',
  gray_concrete: '#36393D',
  light_gray_concrete: '#7D7D73',
  red_concrete: '#8E2121',
  blue_concrete: '#2C2E8E',
  green_concrete: '#495B24',
  yellow_concrete: '#E9C13A',
  orange_concrete: '#E06101',

  // Wool
  white_wool: '#E8E8E8',
  black_wool: '#1A1A1E',

  // Paths
  dirt_path: '#9B8850',

  // Misc
  bedrock: '#4A4A4A',
  cobweb: '#C8C8C8',
  torch: '#E0A020',
  crafting_table: '#6B5030',
  furnace: '#6B6B6B',
  chest: '#8B6530',
  bookshelf: '#6B5030',
  rail: '#7B7B7B',
  spawner: '#1A3050',
  barrier: '#FF0000',
};

// Default color for unknown blocks
const DEFAULT_COLOR = '#4A4A52';
const AIR_COLOR = '#0a0a0c'; // match the map background

export function getBlockColor(blockName: string): string {
  if (blockName === 'air' || blockName === 'cave_air' || blockName === 'void_air' || blockName === 'unknown') {
    return AIR_COLOR;
  }
  // Direct lookup
  if (BLOCK_COLORS[blockName]) return BLOCK_COLORS[blockName];

  // Fuzzy matching for variants (e.g., "stripped_oak_log" → oak_log, "polished_granite" → granite)
  for (const [key, color] of Object.entries(BLOCK_COLORS)) {
    if (blockName.includes(key)) return color;
  }

  // Category-based fallback
  if (blockName.includes('log') || blockName.includes('wood')) return '#6B5030';
  if (blockName.includes('leaves')) return '#3B7A1A';
  if (blockName.includes('planks')) return '#AF8F55';
  if (blockName.includes('stone')) return '#7F7F7F';
  if (blockName.includes('sand')) return '#DBCFA0';
  if (blockName.includes('ore')) return '#636363';
  if (blockName.includes('wool')) return '#C8C8C8';
  if (blockName.includes('concrete')) return '#7D7D73';
  if (blockName.includes('terracotta')) return '#985838';
  if (blockName.includes('coral')) return '#E05080';
  if (blockName.includes('slab') || blockName.includes('stairs') || blockName.includes('wall')) return '#7F7F7F';
  if (blockName.includes('fence') || blockName.includes('gate')) return '#6B5030';
  if (blockName.includes('glass')) return '#A0C8E8';
  if (blockName.includes('door') || blockName.includes('trapdoor')) return '#6B5030';
  if (blockName.includes('copper')) return '#7B8E6B';
  if (blockName.includes('amethyst')) return '#8050A0';
  if (blockName.includes('mushroom')) return '#8B4020';

  return DEFAULT_COLOR;
}
