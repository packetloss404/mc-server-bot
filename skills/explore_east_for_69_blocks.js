async function explore_east_for_69_blocks(bot) {
  const targetX = bot.entity.position.x + 69;
  await exploreUntil('east', 60000, () => {
    return bot.entity.position.x >= targetX - 2;
  });
}