async function craftTwentySprucePlanks(bot) {
  const craftsNeeded = 5; // 5 crafts * 4 planks/craft = 20 planks

  let logs = bot.inventory.items().find(i => i.name === 'spruce_log');
  let logCount = logs ? logs.count : 0;
  if (logCount < craftsNeeded) {
    await mineBlock('spruce_log', craftsNeeded - logCount);
  }
  await craftItem('spruce_planks', craftsNeeded);
}