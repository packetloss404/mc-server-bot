async function exploreWestFor155Blocks(bot) {
  const targetX = bot.entity.position.x - 155;
  await exploreUntil('west', 120, () => {
    // This callback is for finding an item. The task is to just explore,
    // so we can return null to indicate no specific block target.
    // However, since the task mentions "to find new iron_ingot",
    // we should technically look for iron_ore and then smelt it.
    // But the primary instruction is to explore.
    // For now, let's just focus on the movement.
    // If we wanted to find iron_ore, it would look like:
    // bot.findBlock({ matching: b => b.name === 'iron_ore', maxDistance: 32 });
    // Since the task is primarily about exploration distance, we'll let exploreUntil handle the movement.
    // We can add a condition to stop if we've moved roughly 155 blocks west.
    if (bot.entity.position.x <= targetX) {
      return bot.entity.position; // Return current position to stop exploration
    }
    return null;
  });
}