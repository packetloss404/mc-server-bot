async function mineMoreOakLogs(bot) {
  let oakLogsToMine = 3;
  while (oakLogsToMine > 0) {
    const oakLogBlock = bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    });
    if (!oakLogBlock) { console.log("Block not found"); return; }
    if (oakLogBlock) {
      await mineBlock('oak_log', 1);
      oakLogsToMine--;
    } else {
      // If no oak_log is found nearby, explore to find one
      const foundLog = await exploreUntil('north', 600,
      // Explore for up to 30 seconds (600 ticks)
      () => bot.findBlock({
        matching: b => b.name === 'oak_log',
        maxDistance: 32
      }));
      if (foundLog) {
        // Found a log during exploration, now try to mine it
        await mineBlock('oak_log', 1);
        oakLogsToMine--;
      } else {
        // No oak logs found even after exploration
        throw new Error("Could not find any oak_log to mine after exploring.");
      }
    }
  }
}