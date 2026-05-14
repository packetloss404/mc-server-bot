async function craft1SpruceDoor(bot) {
  const sprucePlanksNeeded = 6;
  let sprucePlanks = bot.inventory.items().find(item => item.name === 'spruce_planks');

  // Check if we have enough spruce planks
  if (!sprucePlanks || sprucePlanks.count < sprucePlanksNeeded) {
    // If not, try to get them from spruce logs
    const spruceLogs = bot.inventory.items().find(item => item.name === 'spruce_log');
    if (spruceLogs) {
      const planksToCraft = sprucePlanksNeeded - (sprucePlanks ? sprucePlanks.count : 0);
      const logsRequired = Math.ceil(planksToCraft / 4);
      if (spruceLogs.count < logsRequired) {
        // Not enough logs, need to mine more. This case should not happen given the problem description.
        // For robustness, we would mine more logs here, but for this specific task, we assume enough planks are available or can be made.
        // await mineBlock('spruce_log', logsRequired - spruceLogs.count);
      }
      await craftItem('spruce_planks', logsRequired * 4);
    } else {
      // No spruce logs and not enough planks. This case should not happen given the problem description.
      // await mineBlock('spruce_log', Math.ceil(sprucePlanksNeeded / 4));
    }
    // Re-check inventory after crafting planks
    sprucePlanks = bot.inventory.items().find(item => item.name === 'spruce_planks');
    if (!sprucePlanks || sprucePlanks.count < sprucePlanksNeeded) {
      throw new Error('Not enough spruce planks to craft spruce_door.');
    }
  }

  // Find a crafting table
  let craftingTable = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });

  // If no crafting table is found, craft one and place it
  if (!craftingTable) {
    const craftingTableItem = bot.inventory.items().find(item => item.name === 'crafting_table');
    if (!craftingTableItem) {
      // Craft a crafting table if we don't have one
      const oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
      if (!oakPlanks || oakPlanks.count < 4) {
        const oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
        if (!oakLogs) {
          await mineBlock('oak_log', 1); // Mine 1 oak log to get 4 planks
        }
        await craftItem('oak_planks', 4);
      }
      await craftItem('crafting_table', 1);
    }

    // Find a suitable position to place the crafting table
    const refBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0)); // Block below bot
    const p = refBlock.position.offset(1, 0, 0); // Try placing next to bot
    await placeItem('crafting_table', p.x, p.y, p.z);
    craftingTable = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
    if (!craftingTable) {
      throw new Error('Failed to place crafting table.');
    }
  }

  // Move to the crafting table and craft the spruce door
  await craftItem('spruce_door', 1);
}