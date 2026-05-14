async function mineDirtOrGrassForBuildingArea(bot) {
  const blockNames = ['dirt', 'grass_block'];
  let blocksMined = 0;
  const targetCount = 5;
  while (blocksMined < targetCount) {
    let targetBlock = bot.findBlock({
      matching: block => blockNames.includes(block.name),
      maxDistance: 32
    });
    if (!targetBlock) {
      // If no dirt/grass nearby, explore until found
      await exploreUntil('north', 60,
      // Explore for up to 60 seconds
      () => {
        return bot.findBlock({
          matching: block => blockNames.includes(block.name),
          maxDistance: 32
        });
      });
      targetBlock = bot.findBlock({
        matching: block => blockNames.includes(block.name),
        maxDistance: 32
      });
      if (!targetBlock) {
        // If still no target after exploring, give up
        throw new Error('Could not find dirt or grass blocks to mine.');
      }
    }
    await mineBlock(targetBlock.name, 1);
    blocksMined++;
  }
}