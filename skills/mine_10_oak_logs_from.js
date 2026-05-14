async function mine10OakLogs(bot) {
  let oakLogCount = bot.inventory.items().find(item => item.name === 'oak_log')?.count || 0;
  const targetCount = 10;
  while (oakLogCount < targetCount) {
    const remainingToMine = targetCount - oakLogCount;
    let oakLogBlock = bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    });
    if (!oakLogBlock) {
      // Explore to find oak logs if none are nearby
      await exploreUntil('forward', 60, () => {
        // Explore for up to 60 seconds
        oakLogBlock = bot.findBlock({
          matching: b => b.name === 'oak_log',
          maxDistance: 32
        });
        return oakLogBlock ? oakLogBlock.position : null;
      });
      if (!oakLogBlock) {
        // If still no oak logs found after exploring, give up
        throw new Error('Could not find oak_log within reasonable exploration distance.');
      }
    }

    // Mine the found oak logs
    await mineBlock('oak_log', remainingToMine);
    oakLogCount = bot.inventory.items().find(item => item.name === 'oak_log')?.count || 0;
  }
}