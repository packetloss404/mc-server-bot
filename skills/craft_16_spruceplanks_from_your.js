async function craft16SprucePlanks(bot) {
  const targetPlanks = 16;
  let sprucePlanksInInventory = bot.inventory.items().find(item => item.name === 'spruce_planks');
  const currentPlanksCount = sprucePlanksInInventory ? sprucePlanksInInventory.count : 0;

  // We need to ensure we *craft* 16 planks from logs, not just have them.
  // So, we'll calculate logs needed for 16 planks.
  // 1 spruce_log crafts 4 spruce_planks
  const neededLogsFor16Planks = Math.ceil(targetPlanks / 4); // Should be 4 logs for 16 planks

  let spruceLogs = bot.inventory.items().find(item => item.name === 'spruce_log');
  const currentLogsCount = spruceLogs ? spruceLogs.count : 0;
  if (currentLogsCount < neededLogsFor16Planks) {
    await mineBlock('spruce_log', neededLogsFor16Planks - currentLogsCount);
  }

  // After ensuring logs are available, craft the desired amount of planks
  // We want to craft 16 planks, and 1 log gives 4 planks.
  // So, we need to craft 4 times (16 planks / 4 planks_per_log = 4 crafts)
  await craftItem('spruce_planks', targetPlanks);
}