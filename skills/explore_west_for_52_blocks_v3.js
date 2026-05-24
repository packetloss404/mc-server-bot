async function explore_west_for_52_blocks(bot) {
  const startX = bot.entity.position.x;
  const startZ = bot.entity.position.z;
  const targetZ = startZ - 52;
  await exploreUntil('west', 20, () => {
    // Check if we've traveled approximately 52 blocks west
    const currentZ = bot.entity.position.z;
    if (currentZ <= targetZ) {
      return bot.entity.position.clone();
    }
    // Look for iron_ingot in nearby blocks (check chests/barrels)
    const chest = bot.findBlock({
      matching: b => b.name === 'chest' || b.name === 'barrel',
      maxDistance: 16
    });
    if (!chest) { console.log("Block not found"); return; }
    return chest ? chest.position.clone() : null;
  });
}