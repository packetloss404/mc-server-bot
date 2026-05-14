async function craft3CherryPlanks(bot) {
  const itemName = 'cherry_planks';
  const count = 3;

  // Check if we already have enough cherry logs
  let cherryLogs = bot.inventory.items().find(item => item.name === 'cherry_log');
  if (!cherryLogs || cherryLogs.count < 1) {
    // 1 cherry log makes 4 planks, so 1 log is enough for 3 planks
    // If not enough, mine some cherry logs
    await mineBlock('cherry_log', 1);
  }

  // Craft the cherry planks
  await craftItem(itemName, count);
}