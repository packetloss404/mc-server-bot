async function mineDirtOrGrass(bot) {
  const targetBlocks = ['dirt', 'grass_block'];
  let minedCount = 0;
  const totalToMine = 15;
  while (minedCount < totalToMine) {
    const block = bot.findBlock({
      matching: b => targetBlocks.includes(b.name),
      maxDistance: 32
    });
    if (block) {
      // Mine 1 block at a time to update count
      await mineBlock(block.name, 1);
      minedCount++;
    } else {
      // If no block found nearby, explore
      // Explore for up to 60 seconds. Callback will return true if a dirt or grass block is found.
      const foundTarget = await exploreUntil('forward', 60, () => {
        return bot.findBlock({
          matching: b => targetBlocks.includes(b.name),
          maxDistance: 32
        });
      });
      if (!foundTarget) {
        // If exploration didn't find anything, we might be stuck or out of reach
        // This task will likely fail, but we've done our best to explore.
        return;
      }
      // If found, the loop will reiterate and `findBlock` should succeed
    }
  }
}