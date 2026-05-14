async function explore_east_for_63_blocks(bot) {
  await exploreUntil('east', 120000, () => {
    const dx = bot.entity.position.x - 1632;
    return dx >= 63;
  });
}