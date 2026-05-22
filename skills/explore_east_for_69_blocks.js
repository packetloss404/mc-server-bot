async function explore_east_for_69_blocks(bot) {
  const currentPos = bot.entity.position;
  const targetX = Math.floor(currentPos.x) + 69;
  const targetY = Math.floor(currentPos.y);
  const targetZ = Math.floor(currentPos.z);
  await moveTo(targetX, targetY, targetZ, 2, 60);
}