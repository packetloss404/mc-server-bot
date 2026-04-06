async function placeStonecutterAndCraftStairs(bot) {
  let stonecutterItem = bot.inventory.items().find(i => i.name === 'stonecutter');
  if (!stonecutterItem) return;
  let stonecutterBlock = bot.findBlock({
    matching: b => b.name === 'stonecutter',
    maxDistance: 32
  });
  if (!stonecutterBlock) {
    const referenceBlock = bot.findBlock({
      matching: b => ['grass_block', 'dirt', 'stone', 'cobblestone', 'andesite'].includes(b.name),
      maxDistance: 4
    });
    if (referenceBlock) {
      await placeItem('stonecutter', referenceBlock.position.x, referenceBlock.position.y + 1, referenceBlock.position.z);
    } else {
      const pos = bot.entity.position.floored();
      await placeItem('stonecutter', pos.x + 1, pos.y, pos.z);
    }
  }
  const cobblestone = bot.inventory.items().find(i => i.name === 'cobblestone');
  if (!cobblestone || cobblestone.count < 4) {
    await mineBlock('cobblestone', 4 - (cobblestone ? cobblestone.count : 0));
  }
  await craftItem('cobblestone_stairs', 4);
}