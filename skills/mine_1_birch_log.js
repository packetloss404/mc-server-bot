async function mine1BirchLog(bot) {
  const birchLogBlock = await exploreUntil('south', 120,
  // Explore for 120 seconds
  () => {
    return bot.findBlock({
      matching: block => block.name === 'birch_log',
      maxDistance: 32
    });
  });
  if (!birchLogBlock) {
    throw new Error("Could not find birch_log after exploring.");
  }
  await mineBlock('birch_log', 1);
}