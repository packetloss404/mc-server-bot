async function craftSticksFromSprucePlanks(bot) {
  const getStickCount = () => bot.inventory.items().filter(i => i.name === 'stick').reduce((acc, i) => acc + i.count, 0);
  const initialSticks = getStickCount();
  let sprucePlanks = bot.inventory.items().find(i => i.name === 'spruce_planks');
  if (!sprucePlanks || sprucePlanks.count < 2) {
    let spruceLog = bot.inventory.items().find(i => i.name === 'spruce_log');
    if (!spruceLog) {
      const spruceLogBlock = bot.findBlock({
        matching: b => b.name === 'spruce_log',
        maxDistance: 32
      });
      if (!spruceLogBlock) {
        await exploreUntil('north', 60, () => bot.findBlock({
          matching: b => b.name === 'spruce_log',
          maxDistance: 32
        }));
      }
      await mineBlock('spruce_log', 1);
      spruceLog = bot.inventory.items().find(i => i.name === 'spruce_log');
    }
    if (!spruceLog) {
      throw new Error("Could not find or mine a spruce log.");
    }
    await craftItem('spruce_planks', 1);
    sprucePlanks = bot.inventory.items().find(i => i.name === 'spruce_planks');
  }
  if (!sprucePlanks || sprucePlanks.count < 2) {
    throw new Error(`Insufficient spruce planks. Found: ${sprucePlanks ? sprucePlanks.count : 0}`);
  }
  await craftItem('stick', 1);
  const finalSticks = getStickCount();
  if (finalSticks < initialSticks + 4) {
    throw new Error(`Crafting failed: expected at least ${initialSticks + 4} sticks, but found ${finalSticks}.`);
  }
}