async function explore_south_for_60_blocks(bot) {
  const currentPos = bot.entity.position;
  const targetZ = currentPos.z - 60;
  await moveTo(currentPos.x, currentPos.y, targetZ, 2, 60);
}