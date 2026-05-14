async function mine10SpruceLog(bot) {
  let spruceLogCount = 0;
  while (spruceLogCount < 10) {
    const spruceLogBlock = bot.findBlock({
      matching: b => b.name === 'spruce_log',
      maxDistance: 32
    });
    if (!spruceLogBlock) { console.log("Block not found"); return; }
    if (spruceLogBlock) {
      const remainingToMine = 10 - spruceLogCount;
      const amountToMineNow = Math.min(remainingToMine, 1); // Mine one at a time to keep track
      await mineBlock('spruce_log', amountToMineNow);
      spruceLogCount += amountToMineNow; // Assuming mineBlock always succeeds for now
    } else {
      // No spruce_log nearby, explore
      await exploreUntil('north', 60,
      // Explore north for 60 seconds
      () => bot.findBlock({
        matching: b => b.name === 'spruce_log',
        maxDistance: 32
      }));
      // After exploring, check again. If still no block, break to prevent infinite loop
      if (!bot.findBlock({
        matching: b => b.name === 'spruce_log',
        maxDistance: 32
      })) {
        throw new Error('Could not find enough spruce_log after exploring.');
      }
    }
  }
}