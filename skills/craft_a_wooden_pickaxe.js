async function craftAWoodenPickaxe(bot) {
  const pickaxe = bot.inventory.items().find(i => i.name === 'wooden_pickaxe');
  if (pickaxe) return;
  let craftingTable = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!craftingTable) {
    await moveTo(974, 75, 375, 3);
    craftingTable = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }
  if (!craftingTable) {
    const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) {
      await craftItem('crafting_table', 1);
    }
    const pos = bot.entity.position;
    await placeItem('crafting_table', Math.floor(pos.x) + 1, Math.floor(pos.y), Math.floor(pos.z));
  }
  await craftItem('wooden_pickaxe', 1);
}