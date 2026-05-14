async function craft9OakPlanks(bot) {
  const targetPlanks = 9;
  let planksInInventory = bot.inventory.items().find(item => item.name === 'oak_planks')?.count || 0;
  if (planksInInventory >= targetPlanks) {
    return; // Already have enough oak planks
  }
  const planksToCraft = targetPlanks - planksInInventory;
  const logsNeeded = Math.ceil(planksToCraft / 4); // 1 oak log makes 4 oak planks

  let logsInInventory = bot.inventory.items().find(item => item.name === 'oak_log')?.count || 0;
  if (logsInInventory < logsNeeded) {
    const additionalLogsToMine = logsNeeded - logsInInventory;
    await mineBlock('oak_log', additionalLogsToMine);
    logsInInventory = bot.inventory.items().find(item => item.name === 'oak_log')?.count || 0;
  }

  // Craft the required planks
  // Ensure we don't try to craft more than available logs can make
  const actualPlanksToCraft = Math.min(planksToCraft, logsInInventory * 4);
  if (actualPlanksToCraft > 0) {
    await craftItem('oak_planks', actualPlanksToCraft);
  }
}