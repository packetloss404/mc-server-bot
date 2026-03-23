async function mineOneBrownMushroom(bot) {
  const target = 'brown_mushroom';
  while (true) {
    const item = bot.inventory.items().find(i => i.name === target);
    if (item && item.count >= 1) break;
    const block = bot.findBlock({
      matching: b => b.name === target,
      maxDistance: 32
    });
    if (!block) {
      await exploreUntil('north', 60, () => {
        return bot.findBlock({
          matching: b => b.name === target,
          maxDistance: 32
        });
      });
    }
    await mineBlock(target, 1);
  }
}