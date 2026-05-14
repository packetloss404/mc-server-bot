async function exploreEastFor208Blocks(bot) {
  const startX = bot.entity.position.x;
  const targetX = startX + 208;
  // Calculate a target position 208 blocks to the east
  const targetPos = bot.entity.position.offset(208, 0, 0);

  // Move to the target position. range can be 1-2 blocks tolerance.
  // Set a reasonable timeout, e.g., 60 seconds.
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 2, 60);
}