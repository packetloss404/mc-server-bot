async function explore_east_for_52_blocks(bot) {
  const startX = bot.entity.position.x;
  const targetX = startX + 52;
  const y = bot.entity.position.y;
  const z = bot.entity.position.z;
  await exploreUntil('east', 120, () => {
    if (bot.entity.position.x >= targetX) {
      return {
        x: bot.entity.position.x,
        y: bot.entity.position.y,
        z: bot.entity.position.z
      };
    }
    return null;
  });
}