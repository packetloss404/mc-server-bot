async function explore_east_for_58_blocks(bot) {
  const startX = bot.entity.position.x;
  const targetX = startX + 58;
  await exploreUntil('east', 25, () => {
    // Check if we've reached the target distance
    if (bot.entity.position.x >= targetX - 5) {
      return true;
    }
    // Look for iron ore nearby
    const ironOre = bot.findBlock({
      matching: b => b.name === 'iron_ore',
      maxDistance: 16
    });
    if (!ironOre) { console.log("Block not found"); return; }
    return ironOre || null;
  });
}