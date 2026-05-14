async function explore_east_for_73_blocks(bot) {
  const startX = Math.floor(bot.entity.position.x);
  const y = Math.floor(bot.entity.position.y);
  const z = Math.floor(bot.entity.position.z);
  const targetX = startX + 73;
  await moveTo(targetX, y, z, 2, 120);
}