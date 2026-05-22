async function explore_east_for_56_blocks(bot) {
  const startPos = bot.entity.position;
  const targetX = startPos.x + 56;
  await moveTo(targetX, startPos.y, startPos.z, 2, 60);
}