async function buildFourWallsUsingOakPlanks(bot) {
  // Check current oak_planks inventory
  let planksItem = bot.inventory.items().find(i => i.name === 'oak_planks');
  let plankCount = planksItem ? planksItem.count : 0;

  // We need 4 walls × 3 blocks high = 12 blocks minimum
  // Let's aim for 16 to be safe
  if (plankCount < 16) {
    // Check if we have oak logs to craft
    let logsItem = bot.inventory.items().find(i => i.name === 'oak_log');
    let logCount = logsItem ? logsItem.count : 0;

    // Need 4 logs to make 16 planks (1 log = 4 planks)
    if (logCount < 4) {
      // Find and mine oak logs
      let logBlock = bot.findBlock({
        matching: b => b.name === 'oak_log',
        maxDistance: 32
      });
      if (!logBlock) {
        await exploreUntil(new Vec3(1, 0, 1), 60000, () => bot.findBlock({
          matching: b => b.name === 'oak_log',
          maxDistance: 32
        }));
      }
      await mineBlock('oak_log', 4 - logCount);
    }

    // Craft oak planks
    await craftItem('oak_planks', 16 - plankCount);
  }

  // Build 4 walls in a square formation around current position
  const startPos = bot.entity.position.floored();

  // Define 4 walls: North, South, East, West
  const walls = [
  // North wall (z - 2)
  [{
    x: startPos.x - 1,
    y: startPos.y,
    z: startPos.z - 2
  }, {
    x: startPos.x,
    y: startPos.y,
    z: startPos.z - 2
  }, {
    x: startPos.x + 1,
    y: startPos.y,
    z: startPos.z - 2
  }],
  // South wall (z + 2)
  [{
    x: startPos.x - 1,
    y: startPos.y,
    z: startPos.z + 2
  }, {
    x: startPos.x,
    y: startPos.y,
    z: startPos.z + 2
  }, {
    x: startPos.x + 1,
    y: startPos.y,
    z: startPos.z + 2
  }],
  // East wall (x + 2)
  [{
    x: startPos.x + 2,
    y: startPos.y,
    z: startPos.z - 1
  }, {
    x: startPos.x + 2,
    y: startPos.y,
    z: startPos.z
  }, {
    x: startPos.x + 2,
    y: startPos.y,
    z: startPos.z + 1
  }],
  // West wall (x - 2)
  [{
    x: startPos.x - 2,
    y: startPos.y,
    z: startPos.z - 1
  }, {
    x: startPos.x - 2,
    y: startPos.y,
    z: startPos.z
  }, {
    x: startPos.x - 2,
    y: startPos.y,
    z: startPos.z + 1
  }]];

  // Place blocks for each wall at 3 heights
  for (const wall of walls) {
    for (const basePos of wall) {
      for (let height = 0; height < 3; height++) {
        const placePos = {
          x: basePos.x,
          y: basePos.y + height,
          z: basePos.z
        };
        await placeItem('oak_planks', placePos.x, placePos.y, placePos.z);
      }
    }
  }
}