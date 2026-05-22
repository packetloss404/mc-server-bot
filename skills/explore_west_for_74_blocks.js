async function explore_west_for_74_blocks(bot) {
  const currentPos = bot.entity.position;
  const targetX = currentPos.x - 74;
  await moveTo(targetX, currentPos.y, currentPos.z, 2, 60);
}