async function mine3OakLogsFromNearby(bot) {
  let oakLogsMined = bot.inventory.items().find(item => item.name === 'oak_log')?.count || 0;
  const targetCount = 3;
  while (oakLogsMined < targetCount) {
    const oakLogBlock = bot.findBlock({
      matching: block => block.name === 'oak_log',
      maxDistance: 32
    });
    if (!oakLogBlock) { console.log("Block not found"); return; }
    if (oakLogBlock) {
      await mineBlock('oak_log', 1);
      oakLogsMined = bot.inventory.items().find(item => item.name === 'oak_log')?.count || 0;
    } else {
      // If no oak_log is nearby, explore until one is found
      const foundBlock = await exploreUntil('forward', 60, () => {
        return bot.findBlock({
          matching: block => block.name === 'oak_log',
          maxDistance: 32
        });
      });
      if (foundBlock) {
        // Now that one is found, mine it
        await mineBlock('oak_log', 1);
        oakLogsMined = bot.inventory.items().find(item => item.name === 'oak_log')?.count || 0;
      } else {
        // If still no oak_log found after exploring, something is wrong
        throw new Error("Could not find oak_log even after exploring.");
      }
    }
  }
}