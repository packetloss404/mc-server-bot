async function plantOakSaplingsFarm(bot) {
  // Check if we have oak saplings in inventory
  let saplingItem = bot.inventory.items().find(i => i.name === 'oak_sapling');
  if (!saplingItem || saplingItem.count < 13) {
    // Need to get oak saplings - craft from oak logs if needed
    const logItem = bot.inventory.items().find(i => i.name === 'oak_log');
    if (!logItem || logItem.count < 4) {
      await mineBlock('oak_log', 4);
    }
    await craftItem('oak_sapling', 13);
  }

  // Find and move to the water source at 1040, 62, 232
  await moveTo(1040, 62, 232, 1, 30);

  // Plant saplings in a 4x4 grid pattern around the water source
  // Use dirt/grass blocks that are not occupied by stone
  const positions = [{
    x: 1039,
    y: 63,
    z: 231
  }, {
    x: 1040,
    y: 63,
    z: 231
  }, {
    x: 1041,
    y: 63,
    z: 231
  }, {
    x: 1042,
    y: 63,
    z: 231
  }, {
    x: 1039,
    y: 63,
    z: 232
  }, {
    x: 1040,
    y: 63,
    z: 232
  }, {
    x: 1041,
    y: 63,
    z: 232
  }, {
    x: 1042,
    y: 63,
    z: 232
  }, {
    x: 1039,
    y: 63,
    z: 233
  }, {
    x: 1040,
    y: 63,
    z: 233
  }, {
    x: 1041,
    y: 63,
    z: 233
  }, {
    x: 1042,
    y: 63,
    z: 233
  }, {
    x: 1040,
    y: 63,
    z: 234
  }];

  // Plant saplings at each position
  for (const pos of positions) {
    await placeItem('oak_sapling', pos.x, pos.y, pos.z);
  }
}