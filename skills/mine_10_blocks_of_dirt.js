async function mine_10_blocks_of_dirt(bot) {
  const targetBlockNames = ['dirt', 'grass_block'];
  let blocksMined = 0;
  while (blocksMined < 10) {
    const block = bot.findBlock({
      matching: b => targetBlockNames.includes(b.name),
      maxDistance: 32
    });
    if (block) {
      await mineBlock(block.name, 1);
      blocksMined++;
    } else {
      // If no dirt or grass_block is found nearby, explore
      await exploreUntil('north', 60,
      // Explore for 60 seconds
      () => bot.findBlock({
        matching: b => targetBlockNames.includes(b.name),
        maxDistance: 32
      }));
      // After exploring, try to find the block again
      const foundBlockAfterExplore = bot.findBlock({
        matching: b => targetBlockNames.includes(b.name),
        maxDistance: 32
      });
      if (!foundBlockAfterExplore) {
        // If still no block found after exploring, it might be stuck or out of reach
        throw new Error("Could not find dirt or grass_block even after exploring.");
      }
    }
  }
}