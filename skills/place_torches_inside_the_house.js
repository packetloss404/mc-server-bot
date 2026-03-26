async function placeTorchesInsideHouse(bot) {
  // Check current torch inventory
  let torchItem = bot.inventory.items().find(i => i.name === 'torch');
  let torchCount = torchItem ? torchItem.count : 0;

  // If we don't have torches, craft them
  if (torchCount < 8) {
    // Check for coal
    const coalItem = bot.inventory.items().find(i => i.name === 'coal');
    let coalCount = coalItem ? coalItem.count : 0;

    // Check for sticks
    const stickItem = bot.inventory.items().find(i => i.name === 'stick');
    let stickCount = stickItem ? stickItem.count : 0;

    // Mine coal if needed
    if (coalCount < 1) {
      await mineBlock('coal_ore', 1);
    }

    // Mine wood and craft sticks if needed
    if (stickCount < 8) {
      const logItem = bot.inventory.items().find(i => i.name.endsWith('_log'));
      if (!logItem) {
        await mineBlock('oak_log', 1);
      }
      // Craft sticks from logs
      await craftItem('stick', 8 - stickCount);
    }

    // Craft torches (1 coal + 8 sticks = 8 torches)
    await craftItem('torch', 8);
  }

  // Place torches inside the house at strategic locations
  // Placing torches around interior walls for lighting
  const torchPositions = [{
    x: 933,
    y: 77,
    z: 208
  }, {
    x: 933,
    y: 77,
    z: 212
  }, {
    x: 937,
    y: 77,
    z: 208
  }, {
    x: 937,
    y: 77,
    z: 212
  }, {
    x: 935,
    y: 77,
    z: 210
  }];
  for (const pos of torchPositions) {
    await placeItem('torch', pos.x, pos.y, pos.z);
  }
}