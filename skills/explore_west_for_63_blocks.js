async function explore_west_for_63_blocks(bot) {
  // Move west 63 blocks from current position (864, 72, 226)
  const targetX = bot.entity.position.x - 63;
  await moveTo(targetX, bot.entity.position.y, bot.entity.position.z, 2, 30);
}