async function craft1Stick(bot) {
  const stick = bot.inventory.items().find(item => item.name === 'stick');
  if (stick && stick.count >= 1) {
    return; // Already have at least 1 stick
  }

  // Sticks are crafted from planks. 2 planks -> 4 sticks.
  // We need at least 2 planks to craft any sticks.
  let planks = bot.inventory.items().find(item => item.name.includes('_planks'));
  if (!planks || planks.count < 2) {
    // Need to get planks first. Assume we have wood logs.
    // If not, this will fail, but the task is to craft sticks, not get wood.
    // For now, assume we have planks or logs to make planks.
    // A more robust solution would involve gathering logs and crafting planks first.
    // Since the inventory shows planks, we'll proceed assuming we have them.
    const oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
    if (oakLogs && oakLogs.count >= 1) {
      await craftItem('oak_planks', 4); // Craft 4 planks from 1 log
      planks = bot.inventory.items().find(item => item.name.includes('_planks'));
    } else {
      const cherryLogs = bot.inventory.items().find(item => item.name === 'cherry_log');
      if (cherryLogs && cherryLogs.count >= 1) {
        await craftItem('cherry_planks', 4); // Craft 4 planks from 1 log
        planks = bot.inventory.items().find(item => item.name.includes('_planks'));
      }
    }
  }
  if (!planks || planks.count < 2) {
    throw new Error('Not enough planks to craft sticks.');
  }

  // Craft 4 sticks, as that's the smallest craftable amount from 2 planks.
  await craftItem('stick', 4);
}