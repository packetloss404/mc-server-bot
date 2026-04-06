async function placeTwoOakStairs(bot) {
  const targetX = 959;
  const targetY = 72;
  const targetZ = 357;
  const stairsItem = bot.inventory.items().find(i => i.name === 'oak_stairs');
  if (!stairsItem || stairsItem.count < 2) {
    const planks = bot.inventory.items().find(i => i.name === 'oak_planks');
    if (!planks || planks.count < 6) {
      const logs = bot.inventory.items().find(i => i.name === 'oak_log');
      if (!logs || logs.count < 2) {
        await mineBlock('oak_log', 2);
      }
      await craftItem('oak_planks', 2);
    }
    await craftItem('oak_stairs', 1);
  }
  await moveTo(targetX, targetY, targetZ, 3, 10);
  await placeItem('oak_stairs', targetX, targetY, targetZ);
  await placeItem('oak_stairs', targetX, targetY + 1, targetZ);
}