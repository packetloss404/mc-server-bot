async function exploreEastFor94Blocks(bot) {
  const startX = bot.entity.position.x;
  const targetX = startX + 94; // Calculate the target X coordinate
  await exploreUntil('east', 120, () => {
    // maxTime 120 seconds to allow for 94 blocks of movement
    return bot.entity.position.x >= targetX; // Stop when the bot has moved far enough east
  });
}