async function explore_east_for_66_blocks(bot) {
  const startPos = bot.entity.position;
  const targetX = startPos.x + 66;
  await moveTo(targetX, startPos.y, startPos.z, 2, 30);
}