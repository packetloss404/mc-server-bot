async function explore_west_for_61_blocks(bot) {
  const currentPos = bot.entity.position;
  const targetX = currentPos.x - 61;
  await moveTo(targetX, currentPos.y, currentPos.z, 2, 30);
}