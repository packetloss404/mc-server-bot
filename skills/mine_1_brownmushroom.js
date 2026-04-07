async function mineOneBrownMushroom(bot) {
  const target = 'brown_mushroom';
  for (let iter = 0; iter < 8; iter++) {
    const item = bot.inventory.items().find(i => i.name === target);
    if (item && item.count >= 1) break;
    const block = bot.findBlock({
      matching: b => b.name === target,
      maxDistance: 32
    });
    if (!block) {
      await exploreUntil({ x: 0, y: 0, z: -1 }, 60, () => {
        return bot.findBlock({
          matching: b => b.name === target,
          maxDistance: 32
        });
      });
    }
    await mineBlock(target, 1);
  }
}