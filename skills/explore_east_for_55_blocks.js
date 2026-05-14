async function explore_east_for_55_blocks(bot) {
  const startPos = bot.entity.position;
  const targetX = Math.floor(startPos.x) + 55;
  await moveTo(targetX, Math.floor(startPos.y), Math.floor(startPos.z), 3, 120);
}