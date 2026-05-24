async function towntownmph4x8tze3237864_needs_32_more_wood(bot) {
  const inv = bot.inventory.items();
  const existingLogs = inv.filter(i => i.name.includes('_log')).reduce((sum, i) => sum + i.count, 0);
  const needed = Math.max(0, 32 - existingLogs);
  if (needed <= 0) return;

  // Drop junk to free slots for logs
  await dropJunk(6, 20);

  // Find a log block
  const logBlock = await exploreUntil('north', 25, () => bot.findBlock({
    matching: block => ['oak_log', 'spruce_log', 'birch_log', 'jungle_log'].includes(block.name),
    maxDistance: 32
  }));
  if (!logBlock) return;

  // Move to the log and mine it
  await moveTo(logBlock.position.x, logBlock.position.y, logBlock.position.z, 3, 15);

  // Count current logs after moving
  const inv2 = bot.inventory.items();
  const currentLogs = inv2.filter(i => i.name.includes('_log')).reduce((sum, i) => sum + i.count, 0);
  const remaining = Math.max(0, 32 - currentLogs);
  if (remaining > 0) {
    // Mine oak logs first (most common)
    await mineBlock('oak_log', remaining);
  }

  // Check if we need more
  const inv3 = bot.inventory.items();
  const finalLogs = inv3.filter(i => i.name.includes('_log')).reduce((sum, i) => sum + i.count, 0);
  const stillNeeded = Math.max(0, 32 - finalLogs);
  if (stillNeeded > 0) {
    // Try spruce logs
    await mineBlock('spruce_log', stillNeeded);
  }
}