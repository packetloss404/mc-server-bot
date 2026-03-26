async function buildRoofUsingOakSlabs(bot) {
  // First, we need oak slabs to build the roof
  // Check current oak_slab inventory
  let slabsItem = bot.inventory.items().find(i => i.name === 'oak_slab');
  let slabCount = slabsItem ? slabsItem.count : 0;

  // Estimate slabs needed for a roof over 4 walls
  // Assuming a 5x5 structure (4 walls around current position), we need roughly 20 slabs
  if (slabCount < 20) {
    // Check if we have oak planks to craft slabs
    let planksItem = bot.inventory.items().find(i => i.name === 'oak_planks');
    let plankCount = planksItem ? planksItem.count : 0;

    // Need 10 planks to make 20 slabs (3 planks = 6 slabs)
    if (plankCount < 10) {
      // Check if we have oak logs to craft planks
      let logsItem = bot.inventory.items().find(i => i.name === 'oak_log');
      let logCount = logsItem ? logsItem.count : 0;

      // Need 4 logs to make 16 planks
      if (logCount < 4) {
        // Find and mine oak logs
        let logBlock = bot.findBlock({
          matching: b => b.name === 'oak_log',
          maxDistance: 32
        });
        if (!logBlock) {
          // Explore to find oak logs
          logBlock = await exploreUntil('forward', 30000, () => {
            return bot.findBlock({
              matching: b => b.name === 'oak_log',
              maxDistance: 32
            });
          });
        }
        if (logBlock) {
          await mineBlock('oak_log', 4);
        }
      }

      // Craft planks from logs
      await craftItem('oak_planks', 10);
    }

    // Craft slabs from planks
    await craftItem('oak_slab', 20);
  }

  // Now place the oak slabs on top of the walls
  // Assuming 4 walls at height 3, we place slabs at height 4
  const basePos = bot.entity.position;
  const centerX = Math.floor(basePos.x);
  const centerY = Math.floor(basePos.y);
  const centerZ = Math.floor(basePos.z);

  // Define the 4 roof positions (top of walls in a 5x5 pattern)
  const roofPositions = [
  // North wall (z - 2)
  {
    x: centerX - 2,
    y: centerY + 3,
    z: centerZ - 2
  }, {
    x: centerX - 1,
    y: centerY + 3,
    z: centerZ - 2
  }, {
    x: centerX,
    y: centerY + 3,
    z: centerZ - 2
  }, {
    x: centerX + 1,
    y: centerY + 3,
    z: centerZ - 2
  }, {
    x: centerX + 2,
    y: centerY + 3,
    z: centerZ - 2
  },
  // South wall (z + 2)
  {
    x: centerX - 2,
    y: centerY + 3,
    z: centerZ + 2
  }, {
    x: centerX - 1,
    y: centerY + 3,
    z: centerZ + 2
  }, {
    x: centerX,
    y: centerY + 3,
    z: centerZ + 2
  }, {
    x: centerX + 1,
    y: centerY + 3,
    z: centerZ + 2
  }, {
    x: centerX + 2,
    y: centerY + 3,
    z: centerZ + 2
  },
  // East wall (x + 2)
  {
    x: centerX + 2,
    y: centerY + 3,
    z: centerZ - 1
  }, {
    x: centerX + 2,
    y: centerY + 3,
    z: centerZ
  }, {
    x: centerX + 2,
    y: centerY + 3,
    z: centerZ + 1
  },
  // West wall (x - 2)
  {
    x: centerX - 2,
    y: centerY + 3,
    z: centerZ - 1
  }, {
    x: centerX - 2,
    y: centerY + 3,
    z: centerZ
  }, {
    x: centerX - 2,
    y: centerY + 3,
    z: centerZ + 1
  }];

  // Place oak slabs on roof positions
  for (const pos of roofPositions) {
    await placeItem('oak_slab', pos.x, pos.y, pos.z);
  }
}