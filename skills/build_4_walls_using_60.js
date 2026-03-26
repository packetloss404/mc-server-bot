async function buildFourWallsUsingOakPlanks(bot) {
  // Check current oak_planks inventory
  let planksItem = bot.inventory.items().find(i => i.name === 'oak_planks');
  let plankCount = planksItem ? planksItem.count : 0;

  // We need 60 oak planks for 4 walls of 3 blocks high
  if (plankCount < 60) {
    // Check if we have oak logs to craft
    let logsItem = bot.inventory.items().find(i => i.name === 'oak_log');
    let logCount = logsItem ? logsItem.count : 0;

    // Need 15 logs to make 60 planks (1 log = 4 planks)
    const logsNeeded = Math.ceil((60 - plankCount) / 4);
    if (logCount < logsNeeded) {
      // Find and mine oak logs
      let logBlock = bot.findBlock({
        matching: b => b.name === 'oak_log',
        maxDistance: 32
      });
      if (!logBlock) {
        logBlock = await exploreUntil(new Vec3(1, 0, 1), 60000, () => bot.findBlock({
          matching: b => b.name === 'oak_log',
          maxDistance: 32
        }));
      }
      await mineBlock('oak_log', logsNeeded - logCount);
    }

    // Craft oak planks
    await craftItem('oak_planks', 60 - plankCount);
  }

  // Get current position
  const pos = bot.entity.position;
  const centerX = Math.floor(pos.x);
  const centerY = Math.floor(pos.y);
  const centerZ = Math.floor(pos.z);

  // Build 4 walls in a square pattern around current position
  // Wall dimensions: 5x5 square, 3 blocks high
  const walls = [
  // North wall (z - 2)
  {
    start: {
      x: centerX - 2,
      y: centerY,
      z: centerZ - 2
    },
    end: {
      x: centerX + 2,
      y: centerY,
      z: centerZ - 2
    }
  },
  // South wall (z + 2)
  {
    start: {
      x: centerX - 2,
      y: centerY,
      z: centerZ + 2
    },
    end: {
      x: centerX + 2,
      y: centerY,
      z: centerZ + 2
    }
  },
  // East wall (x + 2)
  {
    start: {
      x: centerX + 2,
      y: centerY,
      z: centerZ - 2
    },
    end: {
      x: centerX + 2,
      y: centerY,
      z: centerZ + 2
    }
  },
  // West wall (x - 2)
  {
    start: {
      x: centerX - 2,
      y: centerY,
      z: centerZ - 2
    },
    end: {
      x: centerX - 2,
      y: centerY,
      z: centerZ + 2
    }
  }];

  // Build each wall
  for (const wall of walls) {
    const startX = wall.start.x;
    const endX = wall.end.x;
    const startZ = wall.start.z;
    const endZ = wall.end.z;

    // Iterate through wall blocks
    for (let x = Math.min(startX, endX); x <= Math.max(startX, endX); x++) {
      for (let z = Math.min(startZ, endZ); z <= Math.max(startZ, endZ); z++) {
        // Build 3 blocks high
        for (let y = centerY; y < centerY + 3; y++) {
          await placeItem('oak_planks', x, y, z);
        }
      }
    }
  }
}