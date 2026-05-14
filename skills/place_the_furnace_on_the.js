async function placeFurnaceOnGrassBlock(bot) {
  const targetX = 882;
  const targetY = 72;
  const targetZ = 224;

  // Check if the bot has a furnace in its inventory
  const furnace = bot.inventory.items().find(item => item.name === 'furnace');
  if (!furnace) {
    // If no furnace, try to craft one. This assumes raw materials are available.
    // However, the task only asks to place an existing furnace, not craft it.
    // For now, if no furnace, the task cannot be completed.
    // In a real scenario, we'd need to gather cobblestone and craft a furnace.
    // For this specific task, we assume the furnace is either present or the task will fail if not.
    return; // Cannot complete task without a furnace.
  }

  // Move to the target location or close enough to place the block
  await moveTo(targetX, targetY, targetZ, 3, 10);

  // Place the furnace
  await placeItem('furnace', targetX, targetY, targetZ);
}