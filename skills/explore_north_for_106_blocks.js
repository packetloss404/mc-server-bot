async function explore_north_for_106_blocks(bot) {
  // First move 67 blocks north using existing skill
  await explore_north_for_67_blocks(bot);
  // Then move 39 more blocks north (106 - 67 = 39)
  const targetX = bot.entity.position.x;
  const targetY = bot.entity.position.y;
  const targetZ = bot.entity.position.z - 39;
  await moveTo(targetX, targetY, targetZ, 2, 30);
}