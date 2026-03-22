async function craftTableAndEightSticks(bot) {
  const getStickCount = () => bot.inventory.items().filter(i => i.name === 'stick').reduce((acc, i) => acc + i.count, 0);
  const table = bot.inventory.items().find(i => i.name === 'crafting_table');
  const sticks = getStickCount();
  if (table && sticks >= 8) return;

  // Prerequisite: Ensure we have enough planks. 
  // 1 crafting table (4 planks) + 8 sticks (4 planks) = 8 planks total.
  let planks = bot.inventory.items().find(i => i.name === 'oak_planks');
  let currentPlanks = planks ? planks.count : 0;
  if (currentPlanks < 8) {
    let logs = bot.inventory.items().find(i => i.name === 'oak_log');
    // We need up to 2 logs to get 8 planks.
    if (!logs || logs.count < 2) {
      const neededLogs = 2 - (logs ? logs.count : 0);
      await mineBlock('oak_log', neededLogs);
    }
    // Re-check logs after mining
    logs = bot.inventory.items().find(i => i.name === 'oak_log');
    if (logs && logs.count > 0) {
      // Craft enough planks to reach at least 8.
      await craftItem('oak_planks', 8);
    }
  }

  // Craft the crafting table if missing.
  if (!bot.inventory.items().find(i => i.name === 'crafting_table')) {
    await craftItem('crafting_table', 1);
  }

  // Craft sticks until we have at least 8.
  const currentSticks = getStickCount();
  if (currentSticks < 8) {
    await craftItem('stick', 8);
  }
}