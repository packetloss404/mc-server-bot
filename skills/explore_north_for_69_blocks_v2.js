async function explore_north_for_70_blocks(bot) {
  // Move north (negative Z direction) by 70 blocks from current position
  const targetX = bot.entity.position.x;
  const targetY = bot.entity.position.y;
  const targetZ = bot.entity.position.z - 70;
  await moveTo(targetX, targetY, targetZ, 2, 30);
}