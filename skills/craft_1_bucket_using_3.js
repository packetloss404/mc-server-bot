async function craftBucket(bot) {
  const getIronIngotCount = () => {
    const item = bot.inventory.items().find(i => i.name === 'iron_ingot');
    return item ? item.count : 0;
  };
  const getRawIronCount = () => {
    const item = bot.inventory.items().find(i => i.name === 'raw_iron');
    return item ? item.count : 0;
  };
  if (getIronIngotCount() < 3) {
    if (getIronIngotCount() + getRawIronCount() < 3) {
      const needed = 3 - (getIronIngotCount() + getRawIronCount());
      const ironOreBlock = bot.findBlock({
        matching: b => b.name === 'iron_ore',
        maxDistance: 32
      });
      if (!ironOreBlock) {
        await moveTo(952, 52, 390, 3);
      }
      await mineBlock('iron_ore', needed);
    }
    let fuel = bot.inventory.items().find(i => ['coal', 'charcoal', 'oak_planks', 'oak_log'].includes(i.name));
    if (!fuel) {
      await mineBlock('oak_log', 1);
      fuel = bot.inventory.items().find(i => i.name === 'oak_log');
    }
    const furnace = bot.findBlock({
      matching: b => b.name === 'furnace',
      maxDistance: 32
    });
    if (!furnace) {
      await moveTo(962, 70, 372, 3);
    }
    const smeltCount = 3 - getIronIngotCount();
    await smeltItem('raw_iron', fuel.name, smeltCount);
  }
  const craftingTable = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!craftingTable) {
    await moveTo(974, 75, 375, 3);
  }
  await craftItem('bucket', 1);
}