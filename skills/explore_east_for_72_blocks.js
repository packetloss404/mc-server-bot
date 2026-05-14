async function explore_east_for_72_blocks(bot) {
  // Move 72 blocks east from current position
  const currentPos = bot.entity.position;
  const targetX = currentPos.x + 72;
  await moveTo(targetX, currentPos.y, currentPos.z, 2, 120);
}