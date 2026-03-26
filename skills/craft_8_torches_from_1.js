async function craftTorchesAndPlaceAroundBase(bot) {
  // Check if we have a crafting table in inventory
  let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');

  // If no crafting table, craft one
  if (!tableItem) {
    const planksItem = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    let planksCount = planksItem ? planksItem.count : 0;
    if (planksCount < 4) {
      const logItem = bot.inventory.items().find(i => i.name.endsWith('_log'));
      if (!logItem) {
        await mineBlock('oak_log', 1);
      }
      const logName = bot.inventory.items().find(i => i.name.endsWith('_log')).name;
      const plankName = logName.replace('_log', '_planks');
      await craftItem(plankName, 4);
    }
    await craftItem('crafting_table', 1);
  }

  // Place the crafting table at the specified location
  await placeItem('crafting_table', 857, 65, 254);

  // Verify we have coal and sticks
  const coalItem = bot.inventory.items().find(i => i.name === 'coal');
  if (!coalItem || coalItem.count < 1) {
    await mineBlock('coal_ore', 1);
  }
  const sticksItem = bot.inventory.items().find(i => i.name === 'stick');
  if (!sticksItem || sticksItem.count < 8) {
    const needed = 8 - (sticksItem ? sticksItem.count : 0);
    await mineBlock('stick', needed);
  }

  // Move to the crafting table location
  await moveTo(857, 65, 254, 2, 10);

  // Craft 8 torches using the crafting table
  await craftItem('torch', 8);

  // Place torches around the base perimeter for mob defense
  const baseCenter = {
    x: 857,
    y: 64,
    z: 253
  };
  const torchPositions = [{
    x: baseCenter.x + 5,
    y: baseCenter.y + 1,
    z: baseCenter.z
  }, {
    x: baseCenter.x - 5,
    y: baseCenter.y + 1,
    z: baseCenter.z
  }, {
    x: baseCenter.x,
    y: baseCenter.y + 1,
    z: baseCenter.z + 5
  }, {
    x: baseCenter.x,
    y: baseCenter.y + 1,
    z: baseCenter.z - 5
  }, {
    x: baseCenter.x + 4,
    y: baseCenter.y + 1,
    z: baseCenter.z + 4
  }, {
    x: baseCenter.x - 4,
    y: baseCenter.y + 1,
    z: baseCenter.z + 4
  }, {
    x: baseCenter.x + 4,
    y: baseCenter.y + 1,
    z: baseCenter.z - 4
  }, {
    x: baseCenter.x - 4,
    y: baseCenter.y + 1,
    z: baseCenter.z - 4
  }];
  for (const pos of torchPositions) {
    await placeItem('torch', pos.x, pos.y, pos.z);
  }
}