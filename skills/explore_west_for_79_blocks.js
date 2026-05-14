async function exploreWestFor79Blocks(bot) {
  // Calculate the target position 79 blocks west of the current position
  const targetX = bot.entity.position.x - 79;
  const targetY = bot.entity.position.y; // Keep Y coordinate the same
  const targetZ = bot.entity.position.z; // Keep Z coordinate the same

  // Move to the calculated target position.
  // Using a range of 2 blocks to allow for slight variations in pathfinding.
  // Using a timeout of 60 seconds to ensure the bot doesn't get stuck indefinitely.
  await moveTo(targetX, targetY, targetZ, 2, 60);
}