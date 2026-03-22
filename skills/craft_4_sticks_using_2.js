async function craftFourSticksTask(bot) {
  const getStickCount = () => bot.inventory.items().filter(i => i.name === 'stick').reduce((acc, i) => acc + i.count, 0);
  const initialSticks = getStickCount();
  let oakPlanks = bot.inventory.items().find(i => i.name === 'oak_planks');
  if (!oakPlanks || oakPlanks.count < 2) {
    let oakLog = bot.inventory.items().find(i => i.name === 'oak_log');
    if (!oakLog) {
      const oakLogBlock = bot.findBlock({
        matching: b => b.name === 'oak_log',
        maxDistance: 32
      });
      if (!oakLogBlock) {
        await exploreUntil('north', 60, () => bot.findBlock({
          matching: b => b.name === 'oak_log',
          maxDistance: 32
        }));
      }
      await mineBlock('oak_log', 1);
      oakLog = bot.inventory.items().find(i => i.name === 'oak_log');
    }
    if (!oakLog) {
      throw new Error("Could not find or mine an oak log.");
    }

    // Craft 1 log into 4 planks (1 recipe iteration)
    await craftItem('oak_planks', 1);
    oakPlanks = bot.inventory.items().find(i => i.name === 'oak_planks');
  }
  if (!oakPlanks || oakPlanks.count < 2) {
    throw new Error(`Insufficient oak planks. Found: ${oakPlanks ? oakPlanks.count : 0}`);
  }

  // Craft 2 planks into 4 sticks (1 recipe iteration)
  await craftItem('stick', 1);
  const finalSticks = getStickCount();
  if (finalSticks < initialSticks + 4) {
    throw new Error(`Crafting failed: expected at least ${initialSticks + 4} sticks, but found ${finalSticks}.`);
  }
}