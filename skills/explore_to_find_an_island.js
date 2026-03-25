async function exploreToFindIsland(bot) {
  const north = {
    x: 0,
    y: 0,
    z: -1
  };
  const startPosition = bot.entity.position.clone();
  let waterBlock = bot.findBlock({
    matching: b => b.name === 'water',
    maxDistance: 32
  });
  if (!waterBlock) {
    waterBlock = await exploreUntil(north, 60, () => {
      return bot.findBlock({
        matching: b => b.name === 'water',
        maxDistance: 32
      });
    });
  }
  if (waterBlock) {
    await moveTo(waterBlock.position.x, waterBlock.position.y, waterBlock.position.z, 2);
  }
  const boatItem = bot.inventory.items().find(i => i.name === 'oak_boat');
  if (boatItem && waterBlock) {
    await placeItem('oak_boat', waterBlock.position.x, waterBlock.position.y + 1, waterBlock.position.z);
    const boatEntity = bot.nearestEntity(e => e.name === 'boat' || e.name === 'oak_boat');
    if (boatEntity) {
      await bot.mount(boatEntity);
    }
  }
  await exploreUntil(north, 300, () => {
    const landBlock = bot.findBlock({
      matching: b => ['grass_block', 'sand', 'dirt', 'stone', 'gravel', 'clay'].includes(b.name),
      maxDistance: 32
    });
    if (landBlock && landBlock.position.distanceTo(startPosition) > 100) {
      return landBlock;
    }
    return null;
  });
  if (bot.vehicle) {
    await bot.dismount();
  }
  const destination = bot.findBlock({
    matching: b => ['grass_block', 'sand', 'dirt', 'stone', 'gravel', 'clay'].includes(b.name),
    maxDistance: 32
  });
  if (destination) {
    await moveTo(destination.position.x, destination.position.y, destination.position.z, 2);
  }
}