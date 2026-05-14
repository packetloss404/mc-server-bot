async function craft4OakPlanksFromYourOakLog(bot) {
  // Check if we have oak_logs in inventory
  const oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
  if (!oakLogs || oakLogs.count < 1) {
    // If not enough oak logs, the task implies they are provided or expected to be in inventory.
    // Since the task states "from your oak_log", we assume it's already there.
    // If this assumption is wrong, further context would be needed to acquire them.
    return; // Cannot craft without oak_logs
  }

  // Craft 4 oak_planks from the oak_log
  await craftItem('oak_planks', 4);
}