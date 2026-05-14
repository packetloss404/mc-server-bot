async function exploreNorthFor85Blocks(bot) {
  const startPos = bot.entity.position.clone(); // Store initial position
  const targetZ = startPos.z - 85; // North is negative Z

  await exploreUntil('north', 300, () => {
    // 300 seconds (5 minutes) exploration time
    const currentPos = bot.entity.position;
    // Check if we have moved at least 85 blocks north
    if (currentPos.z <= targetZ) {
      // Return a target position near the current location but ensuring we have passed the target Z
      return {
        x: currentPos.x,
        y: currentPos.y,
        z: currentPos.z
      };
    }
    return null; // Continue exploring
  });
}