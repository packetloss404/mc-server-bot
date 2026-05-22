async function explore_east_for_55_blocks(bot) {
  const startX = bot.entity.position.x;
  const targetX = startX + 55;
  await exploreUntil('east', 30, () => {
    const pos = bot.entity.position;
    if (pos.x >= targetX) {
      return {
        x: pos.x,
        y: pos.y,
        z: pos.z
      };
    }
    return null;
  });
}