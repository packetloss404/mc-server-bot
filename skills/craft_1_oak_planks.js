async function craft1OakPlanks(bot) {
  const oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
  if (oakPlanks && oakPlanks.count >= 1) {
    return; // Already have enough oak planks
  }
  const oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
  if (!oakLogs || oakLogs.count < 1) {
    await mineBlock('oak_log', 1); // Collect 1 oak log if not enough
  }
  await craftItem('oak_planks', 1);
}