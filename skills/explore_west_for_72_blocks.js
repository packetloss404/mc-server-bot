async function explore_west_for_72_blocks(bot) {
  const target = bot.entity.position.offset(-72, 0, 0);
  await moveTo(target.x, target.y, target.z, 2, 60);
}