async function explore_west_for_68_blocks(bot) {
  const startX = bot.entity.position.x;
  const targetX = startX - 68;
  await exploreUntil('west', 30, () => {
    const pos = bot.entity.position;
    return pos.x <= targetX;
  });
}