async function explore_west_for_72_blocks(bot) {
  await explore_west_for_68_blocks(bot);
  await moveTo(bot.entity.position.x - 4, bot.entity.position.y, bot.entity.position.z, 2, 15);
}