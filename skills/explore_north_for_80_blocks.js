async function exploreNorthFor80Blocks(bot) {
  const startX = bot.entity.position.x;
  const startZ = bot.entity.position.z;
  const targetZ = startZ - 80; // North is decreasing Z in Minecraft

  // Explore until we reach approximately the target Z coordinate
  await exploreUntil('north', 60, () => {
    // 60 seconds timeout for exploration
    const currentZ = bot.entity.position.z;
    // Check if we have moved at least 80 blocks north
    return currentZ <= targetZ;
  });

  // After exploring, if the task is to find iron_ingot, we might need another step
  // But the current task is "Explore north for 80 blocks to find new iron_ingot"
  // The 'exploreUntil' primitive should handle the movement aspect.
  // The 'find new iron_ingot' part implies that the exploration itself is the goal.
  // No further action is specified to "find" the ingot once the area is explored.
}