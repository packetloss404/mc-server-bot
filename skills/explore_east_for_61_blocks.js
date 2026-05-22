async function explore_east_for_61_blocks(bot) {
  // Move 61 blocks east from current position (874, 63, 98) to (935, 63, 98)
  const targetX = bot.entity.position.x + 61;
  const targetY = bot.entity.position.y;
  const targetZ = bot.entity.position.z;
  await moveTo(targetX, targetY, targetZ, 2, 30);
}