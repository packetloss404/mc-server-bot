async function explore_west_for_65_blocks(bot) {
  const currentPos = bot.entity.position;
  const targetX = currentPos.x - 65;
  await moveTo(targetX, currentPos.y, currentPos.z, 2, 60);
}