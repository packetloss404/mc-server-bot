async function placeChestInsideHouse(bot) {
  // Check if we have a chest in inventory
  let chestItem = bot.inventory.items().find(i => i.name === 'chest');
  if (!chestItem) {
    // Need to craft a chest - requires 8 planks
    const planksItem = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    let planksCount = planksItem ? planksItem.count : 0;
    if (planksCount < 8) {
      // Need to get logs and convert to planks
      const logItem = bot.inventory.items().find(i => i.name.endsWith('_log'));
      if (!logItem) {
        await mineBlock('oak_log', 1);
      }
      const logName = bot.inventory.items().find(i => i.name.endsWith('_log')).name;
      const plankName = logName.replace('_log', '_planks');
      await craftItem(plankName, 8 - planksCount);
    }
    await craftItem('chest', 1);
  }

  // The chest at 881, 74, 223 is already placed outside
  // We need to place a new chest INSIDE the house
  // Crafting table is at 881, 73, 223 - try placing chest nearby inside

  // Try positions inside the house structure
  const interiorPositions = [{
    x: 881,
    y: 74,
    z: 222
  },
  // One block south
  {
    x: 880,
    y: 74,
    z: 223
  },
  // One block west
  {
    x: 882,
    y: 74,
    z: 223
  },
  // One block east
  {
    x: 881,
    y: 74,
    z: 224
  },
  // One block north
  {
    x: 880,
    y: 74,
    z: 222
  },
  // Southwest
  {
    x: 882,
    y: 74,
    z: 222
  } // Southeast
  ];
  for (const pos of interiorPositions) {
    try {
      await moveTo(pos.x, pos.y, pos.z, 2, 10);
      await placeItem('chest', pos.x, pos.y, pos.z);
      return; // Successfully placed
    } catch (e) {
      // Position occupied or unreachable, try next
      continue;
    }
  }

  // If all interior positions failed, try placing at current position
  const currentPos = bot.entity.position;
  await placeItem('chest', Math.floor(currentPos.x), Math.floor(currentPos.y), Math.floor(currentPos.z) - 1);
}