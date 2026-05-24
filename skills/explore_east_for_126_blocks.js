async function explore_east_for_126_blocks(bot) {
  const currentPos = bot.entity.position;
  const targetX = currentPos.x + 126;
  await moveTo(targetX, currentPos.y, currentPos.z, 2, 60);
}