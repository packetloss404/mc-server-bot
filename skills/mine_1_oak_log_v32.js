async function mine_1_oak_log(bot) {
  // World memory shows oak_log at 801,62,134 - move closer first
  await moveTo(801, 62, 134, 3, 15);

  // Now find and mine the oak_log
  const oakLogBlock = bot.findBlock({
    matching: b => b.name === 'oak_log',
    maxDistance: 5
  });
  if (!oakLogBlock) {
    // Explore a bit to find it nearby
    await exploreUntil('north', 30, () => bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 5
    }));
  }
  const target = bot.findBlock({
    matching: b => b.name === 'oak_log',
    maxDistance: 5
  });
  if (!target) {
    throw new Error('Could not find oak_log nearby after moving.');
  }
  await mineBlock('oak_log', 1);
}