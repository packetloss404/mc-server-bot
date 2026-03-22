async function buildStoneSlab3x3Platform(bot) {
  // Target position for the 3x3 platform
  const targetPos = {
    x: 705,
    y: 65,
    z: 553
  };

  // Check current inventory for stone slabs
  let slabItem = bot.inventory.items().find(i => i.name === 'stone_slab');
  let slabCount = slabItem ? slabItem.count : 0;

  // We need 9 stone slabs for a 3x3 platform
  const slab_needed = 9 - slabCount;
  if (slab_needed > 0) {
    // Find stone blocks to mine
    let stoneBlock = bot.findBlock({
      matching: b => b.name === 'stone',
      maxDistance: 32
    });
    if (!stoneBlock) {
      // Explore to find stone
      await exploreUntil(new Vec3(1, 0, 1), 60000, () => bot.findBlock({
        matching: b => b.name === 'stone',
        maxDistance: 32
      }));
      stoneBlock = bot.findBlock({
        matching: b => b.name === 'stone',
        maxDistance: 32
      });
    }

    // Mine enough stone
    await mineBlock('stone', Math.ceil(slab_needed / 2));

    // Craft stone slabs (2 slabs per stone block)
    await craftItem('stone_slab', slab_needed);
  }

  // Move to the platform location
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 1, 30);

  // Place 3x3 platform of stone slabs
  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z++) {
      await placeItem('stone_slab', targetPos.x + x, targetPos.y, targetPos.z + z);
    }
  }
}