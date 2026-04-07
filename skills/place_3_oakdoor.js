async function placeThreeOakDoors(bot) {
  const targetPositions = [{
    x: 942,
    y: 63,
    z: 358
  }, {
    x: 941,
    y: 63,
    z: 358
  }, {
    x: 940,
    y: 63,
    z: 358
  }];

  // Ensure we have oak doors
  let doorItem = bot.inventory.items().find(i => i.name === 'oak_door');
  if (!doorItem || doorItem.count < 3) {
    const logs = bot.inventory.items().find(i => i.name === 'oak_log');
    if (logs) {
      await craftItem('oak_planks', logs.count * 4);
    }
    // Craft doors (one craft produces 3 doors)
    await craftItem('oak_door', 1);
    doorItem = bot.inventory.items().find(i => i.name === 'oak_door');
  }
  if (!doorItem) {
    throw new Error("Could not obtain oak doors for placement.");
  }

  // Place doors at the specified adjacent locations
  for (const pos of targetPositions) {
    // Check if there is a block below to support the door
    const blockBelow = bot.blockAt(bot.entity.position.set(pos.x, pos.y - 1, pos.z));
    if (!blockBelow || blockBelow.name === 'air') {
      // If no ground, try to place a block first (using dirt or planks)
      const support = bot.inventory.items().find(i => i.name === 'dirt' || i.name === 'oak_planks' || i.name === 'andesite');
      if (support) {
        await placeItem(support.name, pos.x, pos.y - 1, pos.z);
      }
    }

    // Move close to the specific target position
    await moveTo(pos.x, pos.y, pos.z, 3, 10);

    // Place the door
    await placeItem('oak_door', pos.x, pos.y, pos.z);
  }
}