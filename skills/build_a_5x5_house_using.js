async function buildOakHouse(bot) {
  // Gather resources
  let logs = bot.inventory.items().find(i => i.name === 'oak_log');
  let logCount = logs ? logs.count : 0;
  if (logCount < 20) {
    await exploreUntil(new Vec3(1, 0, 1), 60000, () => bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    }));
    await mineBlock('oak_log', 20 - logCount);
  }

  // Craft materials
  await craftItem('oak_planks', 64);

  // Ensure we have a crafting table placed to craft a door
  let craftingTable = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!craftingTable) {
    await craftItem('crafting_table', 1);
    const pos = bot.entity.position.floored();
    await placeItem('crafting_table', pos.x + 2, pos.y, pos.z + 2);
  }
  await craftItem('oak_door', 1);

  // Build the 5x5 house
  const startPos = bot.entity.position.floored().offset(2, 0, 2);

  // Clear some space if needed
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 5; z++) {
        // Only build walls
        if (x === 0 || x === 4 || z === 0 || z === 4) {
          // Leave space for door at x=2, z=0
          if (x === 2 && z === 0 && (y === 0 || y === 1)) {
            continue;
          }
          await placeItem('oak_planks', startPos.x + x, startPos.y + y, startPos.z + z);
        }
      }
    }
  }

  // Place the door
  await placeItem('oak_door', startPos.x + 2, startPos.y, startPos.z);
}