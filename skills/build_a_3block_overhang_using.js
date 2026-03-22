async function buildStoneSlabOverhang(bot) {
  // Task: Build a 3-block overhang using stone slabs on the north side of the dirt watchtower at 705,63,554
  // Current position: 705, 63, 554
  // Current inventory: stone_slab x1 (need 3 total)

  const towerPos = bot.entity.position.floored();

  // Check if we have enough stone slabs
  let slabInInventory = bot.inventory.items().find(i => i.name === 'stone_slab');
  let slabCount = slabInInventory ? slabInInventory.count : 0;

  // If we don't have enough stone slabs, mine more
  if (slabCount < 3) {
    await mineBlock('stone_slab', 3 - slabCount);
  }

  // Build the 3-block overhang on the north side
  // North is negative Z direction
  // Place slabs at the top of the tower extending northward
  const overhangHeight = towerPos.y + 5; // Top of the 5-block watchtower

  for (let i = 0; i < 3; i++) {
    await placeItem('stone_slab', towerPos.x, overhangHeight, towerPos.z - 1 - i);
  }
}