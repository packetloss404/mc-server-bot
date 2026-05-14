async function exploreImmediate20BlockRadius(bot) {
  const startPos = bot.entity.position;
  const radius = 20;

  // Define a list of blocks that are typically player-placed or manufactured
  const constructedBlockNames = ['white_terracotta', 'light_blue_glazed_terracotta', 'lime_glazed_terracotta', 'dark_oak_planks', 'stripped_dark_oak_wood', 'purple_glazed_terracotta', 'diorite_wall', 'blue_stained_glass', 'light_blue_concrete', 'lime_concrete', 'crafting_table', 'furnace', 'chest', 'door', 'bed', 'redstone_block', 'stone_bricks', 'cobblestone_wall', 'chiseled_stone_bricks', 'polished_andesite', 'polished_diorite', 'polished_granite', 'bricks', 'nether_bricks', 'purpur_block', 'end_stone_bricks', 'quartz_block', 'smooth_stone', 'andesite', 'diorite', 'granite', 'glass', 'concrete', 'terracotta', 'glazed_terracotta', 'shulker_box', 'beacon', 'enchanting_table', 'brewing_stand', 'anvil', 'grindstone', 'blast_furnace', 'smoker', 'barrel', 'lectern', 'composter', 'cartography_table', 'fletching_table', 'smithing_table', 'stonecutter', 'loom', 'bell', 'campfire', 'soul_campfire', 'lantern', 'soul_lantern', 'scaffolding', 'target', 'hay_block', 'honey_block', 'slime_block', 'piston', 'sticky_piston', 'observer', 'dispenser', 'dropper', 'hopper', 'redstone_lamp', 'daylight_detector', 'tripwire_hook', 'lever', 'stone_button', 'wooden_button', 'pressure_plate', 'weighted_pressure_plate', 'detector_rail', 'activator_rail', 'powered_rail', 'rail', 'tnt', 'jukebox', 'note_block', 'bookshelf', 'ladder', 'iron_bars', 'fence', 'fence_gate', 'wall', 'slab', 'stairs', 'trapdoor', 'iron_door', 'wooden_door', 'sign', 'banner', 'item_frame', 'armor_stand', 'flower_pot', 'skull', 'dragon_head', 'wither_skeleton_skull', 'zombie_head', 'skeleton_skull', 'creeper_head', 'carved_pumpkin', 'jack_o_lantern', 'cake', 'cookie', 'bread', 'golden_apple', 'enchanted_golden_apple', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'cooked_rabbit', 'cooked_cod', 'cooked_salmon', 'baked_potato', 'beetroot_soup', 'mushroom_stew', 'rabbit_stew', 'suspicious_stew', 'honey_bottle', 'sugar', 'cake', 'cookie', 'bread', 'golden_apple', 'enchanted_golden_apple', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'cooked_rabbit', 'cooked_cod', 'cooked_salmon', 'baked_potato', 'beetroot_soup', 'mushroom_stew', 'rabbit_stew', 'suspicious_stew', 'honey_bottle', 'sugar', 'cake', 'cookie', 'bread', 'golden_apple', 'enchanted_golden_apple', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'cooked_rabbit', 'cooked_cod', 'cooked_salmon', 'baked_potato', 'beetroot_soup', 'mushroom_stew', 'rabbit_stew', 'suspicious_stew', 'honey_bottle', 'sugar', 'cake', 'cookie', 'bread', 'golden_apple', 'enchanted_golden_apple', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'cooked_rabbit', 'cooked_cod', 'cooked_salmon', 'baked_potato', 'beetroot_soup', 'mushroom_stew', 'rabbit_stew', 'suspicious_stew', 'honey_bottle', 'sugar', 'cake', 'cookie', 'bread', 'golden_apple', 'enchanted_golden_apple', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'cooked_rabbit', 'cooked_cod', 'cooked_salmon', 'baked_potato', 'beetroot_soup', 'mushroom_stew', 'rabbit_stew', 'suspicious_stew', 'honey_bottle'];

  // This callback function will be used by exploreUntil
  const findConstructedBlockInRadius = currentPosition => {
    // Check for blocks within a small search radius around the current position
    // Since bot.findBlock has a maxDistance of 32, we can use it to search
    // within the exploreUntil's current chunk loading range.
    for (const blockName of constructedBlockNames) {
      const block = bot.findBlock({
        matching: b => b.name === blockName,
        maxDistance: 32 // This is the maximum distance bot.findBlock can search
      });
      if (!block) { console.log("Block not found"); return; }
      if (block) {
        // Return the position of the found block
        return block.position;
      }
    }
    return null; // No constructed block found in the immediate vicinity
  };

  // Explore until a constructed block is found or a certain time limit is reached.
  // The 'direction' parameter for exploreUntil can be arbitrary if the goal is to just explore.
  // Using a short exploration time to stay within "immediate 20-block radius"
  // The exploreUntil primitive handles the movement and chunk loading within its mechanism.
  const targetPos = await exploreUntil('north', 60, findConstructedBlockInRadius); // Explore for up to 60 seconds

  if (targetPos) {
    // If a constructed block was found, move to it to identify its origin/type (by being near it)
    await moveTo(targetPos.x, targetPos.y, targetPos.z, 1, 10); // Move within 1 block range, 10 sec timeout
  }
  // The task implies identification, which is done by finding and moving near it.
  // No explicit return value is required for this task.
}