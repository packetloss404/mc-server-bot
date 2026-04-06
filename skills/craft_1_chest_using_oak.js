async function craftChestUsingOakPlanks(bot) {
  let tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
  let planksNeeded = 8;
  if (!tableBlock && !tableItem) {
    planksNeeded += 4;
  }
  let oakPlanks = bot.inventory.items().find(i => i.name === 'oak_planks');
  let currentPlankCount = oakPlanks ? oakPlanks.count : 0;
  if (currentPlankCount < planksNeeded) {
    let logsNeeded = Math.ceil((planksNeeded - currentPlankCount) / 4);
    let oakLog = bot.inventory.items().find(i => i.name === 'oak_log');
    let currentLogCount = oakLog ? oakLog.count : 0;
    if (currentLogCount < logsNeeded) {
      await mineBlock('oak_log', logsNeeded - currentLogCount);
    }
    await craftItem('oak_planks', planksNeeded - currentPlankCount);
  }
  if (!tableBlock) {
    if (!bot.inventory.items().find(i => i.name === 'crafting_table')) {
      await craftItem('crafting_table', 1);
    }
    const pos = bot.entity.position.offset(1, 0, 0);
    await placeItem('crafting_table', Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
  }
  await craftItem('chest', 1);
}