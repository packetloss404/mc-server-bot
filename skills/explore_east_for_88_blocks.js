async function exploreEastFor88Blocks(bot) {
  const startX = bot.entity.position.x;
  const targetX = startX + 88; // Calculate the target X coordinate 88 blocks east
  const targetY = bot.entity.position.y;
  const targetZ = bot.entity.position.z;

  // Since we are exploring a direction, we use exploreUntil.
  // The callback should return true when the bot has moved approximately 88 blocks east.
  await exploreUntil('east', 60, () => {
    // 60 seconds timeout for exploration
    return bot.entity.position.x >= targetX;
  });
}