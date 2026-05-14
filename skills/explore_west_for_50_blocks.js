async function exploreWestFor50Blocks(bot) {
  // Define the target position 50 blocks west of the current position
  // The bot's current position is bot.entity.position
  // West is typically negative X direction
  const startX = bot.entity.position.x;
  const targetX = startX - 50;
  const targetY = bot.entity.position.y;
  const targetZ = bot.entity.position.z;

  // Use exploreUntil to move west until the target X coordinate is reached or exceeded
  // The callback should return true when the bot has reached the desired western extent
  await exploreUntil('west', 60, () => {
    // 60 seconds timeout for exploration
    return bot.entity.position.x <= targetX;
  });
}