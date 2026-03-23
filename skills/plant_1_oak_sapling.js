async function plantOakSapling(bot) {
  let sapling = bot.inventory.items().find(i => i.name === 'oak_sapling');
  if (!sapling) return;
  const matchFunc = b => {
    if (!b || !b.position) return false;
    if (b.name !== 'grass_block' && b.name !== 'dirt') return false;
    let above = bot.blockAt(b.position.offset(0, 1, 0));
    return above && above.name === 'air';
  };
  let targetBlock = bot.findBlock({
    matching: matchFunc,
    maxDistance: 32
  });
  if (!targetBlock) {
    await exploreUntil({
      x: 1,
      y: 0,
      z: 1
    }, 60, () => bot.findBlock({
      matching: matchFunc,
      maxDistance: 32
    }));
    targetBlock = bot.findBlock({
      matching: matchFunc,
      maxDistance: 32
    });
  }
  if (targetBlock) {
    await placeItem('oak_sapling', targetBlock.position.x, targetBlock.position.y + 1, targetBlock.position.z);
  }
}