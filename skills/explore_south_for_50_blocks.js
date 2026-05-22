async function explore_south_for_50_blocks(bot) {
  const startX = bot.entity.position.x;
  const startY = bot.entity.position.y;
  const startZ = bot.entity.position.z;

  // Move 50 blocks south (positive Z direction)
  const targetX = startX;
  const targetY = startY;
  const targetZ = startZ + 50;

  // Explore south while looking for iron ore or iron ingot
  await exploreUntil('south', 25, () => {
    // Check if we've reached the target
    const pos = bot.entity.position;
    if (Math.abs(pos.z - targetZ) < 3) {
      return true; // Reached destination
    }
    // Look for iron nearby
    const ironOre = bot.findBlock({
      matching: b => b.name === 'iron_ore',
      maxDistance: 16
    });
    if (!ironOre) { console.log("Block not found"); return; }
    if (ironOre) {
      return true; // Found iron ore
    }
    const ironIngot = bot.inventory.items().find(i => i.name === 'iron_ingot');
    if (ironIngot) {
      return true; // Have iron ingot
    }
    return null;
  });
}