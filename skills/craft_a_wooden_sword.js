async function craftWoodenSword(bot) {
  const existingSword = bot.inventory.items().find(i => i.name === 'wooden_sword');
  if (existingSword) return;
  let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
  let sticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!planks || planks.count < 3) {
    let logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
    if (!logs) {
      await mineBlock('oak_log', 1);
      logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
    }
    const plankType = logs.name.replace('_log', '_planks');
    await craftItem(plankType, 2);
    planks = bot.inventory.items().find(i => i.name === plankType);
  }
  if (!sticks || sticks.count < 1) {
    await craftItem('stick', 1);
  }
  await craftItem('wooden_sword', 1);
}