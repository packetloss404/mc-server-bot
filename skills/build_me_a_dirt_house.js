async function buildDirtHouse(bot) {
  // Mine enough dirt blocks for a simple 5x5x3 house structure
  // Floor (5x5) + walls (perimeter) + some roof = ~60 blocks
  const dirtNeeded = 80;
  let dirtInInventory = bot.inventory.items().find(i => i.name === 'dirt');
  let dirtCount = dirtInInventory ? dirtInInventory.count : 0;
  if (dirtCount < dirtNeeded) {
    // Find dirt block nearby
    let dirtBlock = bot.findBlock({
      matching: b => b.name === 'dirt',
      maxDistance: 32
    });

    // If no dirt nearby, explore to find some
    if (!dirtBlock) {
      await exploreUntil(new Vec3(1, 0, 1), 60000, () => bot.findBlock({
        matching: b => b.name === 'dirt',
        maxDistance: 32
      }));
    }

    // Mine the dirt blocks needed
    await mineBlock('dirt', dirtNeeded - dirtCount);
  }

  // Build a simple 5x5x3 dirt house starting 3 blocks away
  const startPos = bot.entity.position.floored().offset(3, 0, 3);

  // Build floor (5x5)
  for (let x = 0; x < 5; x++) {
    for (let z = 0; z < 5; z++) {
      await placeItem('dirt', startPos.x + x, startPos.y, startPos.z + z);
    }
  }

  // Build walls (3 blocks high)
  for (let y = 1; y < 4; y++) {
    // Front and back walls
    for (let x = 0; x < 5; x++) {
      await placeItem('dirt', startPos.x + x, startPos.y + y, startPos.z);
      await placeItem('dirt', startPos.x + x, startPos.y + y, startPos.z + 4);
    }
    // Side walls
    for (let z = 1; z < 4; z++) {
      await placeItem('dirt', startPos.x, startPos.y + y, startPos.z + z);
      await placeItem('dirt', startPos.x + 4, startPos.y + y, startPos.z + z);
    }
  }

  // Build roof (simple flat roof at height 4)
  for (let x = 0; x < 5; x++) {
    for (let z = 0; z < 5; z++) {
      await placeItem('dirt', startPos.x + x, startPos.y + 4, startPos.z + z);
    }
  }
}