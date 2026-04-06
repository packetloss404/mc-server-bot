async function craftAWoodenAxe(bot) {
  const axe = bot.inventory.items().find(i => i.name === 'wooden_axe');
  if (axe) return;
  const planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
  const sticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!planks || planks.count < 3) {
    const logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
    if (!logs) {
      await mineBlock('oak_log', 1);
    }
    await craftItem('oak_planks', 1);
  }
  if (!sticks || sticks.count < 2) {
    const currentPlanks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    if (!currentPlanks || currentPlanks.count < 2) {
      const logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
      if (!logs) {
        await mineBlock('oak_log', 1);
      }
      await craftItem('oak_planks', 1);
    }
    await craftItem('stick', 1);
  }
  let craftingTable = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!craftingTable) {
    let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) {
      const currentPlanks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
      if (!currentPlanks || currentPlanks.count < 4) {
        await mineBlock('oak_log', 1);
        await craftItem('oak_planks', 1);
      }
      await craftItem('crafting_table', 1);
      tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    }
    const pos = bot.entity.position;
    await placeItem('crafting_table', Math.floor(pos.x) + 1, Math.floor(pos.y), Math.floor(pos.z));
    craftingTable = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }
  await craftItem('wooden_axe', 1);
}