async function explore_east_for_71_blocks(bot) {
  // Move 71 blocks east from current position (x + 71)
  const startPos = bot.entity.position;
  const targetX = startPos.x + 71;
  const targetY = startPos.y;
  const targetZ = startPos.z;
  await moveTo(targetX, targetY, targetZ, 2, 60);
}