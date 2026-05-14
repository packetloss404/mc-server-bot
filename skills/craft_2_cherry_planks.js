async function craft2CherryPlanks(bot) {
  const item = bot.inventory.items().find(i => i.name === 'cherry_planks');
  if (item && item.count >= 2) {
    return; // Already have enough
  }

  // Check for cherry_log
  const cherryLog = bot.inventory.items().find(i => i.name === 'cherry_log');
  if (!cherryLog || cherryLog.count < 1) {
    // Need to collect cherry_log first
    await mineBlock('cherry_log', 1);
  }

  // Craft cherry planks
  await craftItem('cherry_planks', 2);
}