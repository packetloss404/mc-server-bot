async function walkToCraftingTableAtLocation(bot) {
  const tablePos = {
    x: 857,
    y: 65,
    z: 254
  };

  // The task category is 'craft' and the previous error was 'crafting_table was not crafted'.
  // This implies the bot needs to craft a crafting table as part of the task.
  const hasTable = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (!hasTable) {
    // Check if we have materials for a crafting table (4 planks).
    // The bot has 1 spruce log and 2 oak planks.
    const spruceLog = bot.inventory.items().find(i => i.name === 'spruce_log');
    if (spruceLog) {
      // 1 log = 4 planks, which is enough for a crafting table.
      await craftItem('spruce_planks', 1);
    } else {
      // If no spruce log, ensure we have enough oak planks or logs.
      const oakPlanks = bot.inventory.items().find(i => i.name === 'oak_planks');
      if (!oakPlanks || oakPlanks.count < 4) {
        await mineBlock('oak_log', 1);
        await craftItem('oak_planks', 1);
      }
    }
    // Craft the crafting table.
    await craftItem('crafting_table', 1);
  }

  // Now that the craft requirement is met, proceed to the target location.
  await moveTo(tablePos.x, tablePos.y, tablePos.z, 1, 60);
}