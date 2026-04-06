async function mineOneOakLog(bot) {
  const targetBlockName = 'oak_log';

  // Check if an oak log is already nearby
  let oakLog = bot.findBlock({
    matching: block => block.name === targetBlockName,
    maxDistance: 32
  });

  // If not found, explore until one is located
  if (!oakLog) {
    oakLog = await exploreUntil(bot, 'north', 60, () => {
      return bot.findBlock({
        matching: block => block.name === targetBlockName,
        maxDistance: 32
      });
    });
  }

  // If we found it (either initially or after exploring), mine it
  if (oakLog) {
    await mineBlock(targetBlockName, 1);
  }
}