async function explore_east_for_75_blocks(bot) {
  const currentPos = bot.entity.position;
  const targetX = currentPos.x + 75;
  await moveTo(targetX, currentPos.y, currentPos.z, 2, 30);
}