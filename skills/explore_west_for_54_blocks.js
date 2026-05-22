async function explore_west_for_54_blocks(bot) {
  // Explore west for 54 blocks to find iron_ingot
  // Current position: 1024, 68, 238 -> target: ~970, 68, 238

  const targetX = bot.entity.position.x - 54;
  await exploreUntil('west', 30, () => {
    // Check for iron_ingot in nearby entities (dropped items)
    const nearbyItem = bot.nearestEntity(e => e.name === 'iron_ingot' || e.name === 'item' && e.position);
    if (!nearbyItem) { console.log("Entity not found"); return; }
    if (nearbyItem) return nearbyItem.position;

    // Check nearby chests for iron_ingot
    const nearbyChest = bot.findBlock({
      matching: b => b.name.includes('chest'),
      maxDistance: 16
    });
    if (nearbyChest) {
      // Iron ingot might be in a chest nearby
      return nearbyChest.position;
    }
    return null;
  });
}