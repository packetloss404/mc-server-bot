async function craftThreeOakDoors(bot) {
  const craftingTablePos = {
    x: 947,
    y: 71,
    z: 363
  };
  let oakPlanks = bot.inventory.items().find(i => i.name === 'oak_planks');
  if (!oakPlanks || oakPlanks.count < 6) {
    const oakLogs = bot.inventory.items().find(i => i.name === 'oak_log');
    if (!oakLogs) {
      await mineBlock('oak_log', 1);
    }
    await craftItem('oak_planks', 2);
  }
  await moveTo(craftingTablePos.x, craftingTablePos.y, craftingTablePos.z, 3, 20);
  await craftItem('oak_door', 1);
}