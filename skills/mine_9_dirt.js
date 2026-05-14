async function mine9Dirt(bot) {
  let dirtBlock = bot.findBlock({
    matching: b => b.name === 'dirt',
    maxDistance: 32
  });
  if (!dirtBlock) {
    // If no dirt nearby, explore to find some
    await exploreUntil('forward', 60, () => {
      dirtBlock = bot.findBlock({
        matching: b => b.name === 'dirt',
        maxDistance: 32
      });
      return dirtBlock;
    });
  }
  if (dirtBlock) {
    await mineBlock('dirt', 9);
  } else {
    // If still no dirt found after exploration, the task might be impossible or require more extensive search
    throw new Error('Could not find dirt to mine.');
  }
}