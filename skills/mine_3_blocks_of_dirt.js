async function mine3DirtBlocks(bot) {
  let dirtBlock = bot.findBlock({
    matching: b => b.name === 'dirt',
    maxDistance: 32
  });
  if (!dirtBlock) {
    await exploreUntil('forward', 60, () => {
      // Explore for 60 seconds
      dirtBlock = bot.findBlock({
        matching: b => b.name === 'dirt',
        maxDistance: 32
      });
      return dirtBlock;
    });
  }
  if (dirtBlock) {
    await mineBlock('dirt', 3);
  } else {
    throw new Error("Could not find dirt block after exploring.");
  }
}