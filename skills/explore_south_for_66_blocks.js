async function explore_south_for_66_blocks(bot) {
  const startZ = bot.entity.position.z;
  const targetZ = startZ - 66;

  // Use exploreUntil to search south for iron ore
  await exploreUntil('south', 60, () => {
    // Check if we've reached the target distance
    if (bot.entity.position.z <= targetZ) {
      return bot.entity.position.clone();
    }
    // Look for iron ore nearby
    const ironOre = bot.findBlock({
      matching: block => block.name === 'iron_ore',
      maxDistance: 16
    });
    if (!ironOre) { console.log("Block not found"); return; }
    if (ironOre) {
      return bot.entity.position.clone();
    }
    return null;
  });
}