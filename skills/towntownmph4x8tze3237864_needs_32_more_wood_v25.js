async function towntownmph4x8tze3237864_needs_32_more_wood(bot) {
  const treeTypes = ['spruce_log', 'oak_log', 'birch_log', 'jungle_log', 'dark_oak_log', 'acacia_log'];
  const inv = bot.inventory.items();
  const currentWood = inv.filter(i => treeTypes.includes(i.name)).reduce((sum, i) => sum + i.count, 0);
  const needed = Math.max(0, 32 - currentWood);
  if (needed === 0) return;
  await dropJunk(6, 30);
  let logBlock = bot.findBlock({
    matching: block => treeTypes.includes(block.name),
    maxDistance: 32
  });
  if (!logBlock) {
    const dirs = ['north', 'east', 'south', 'west'];
    for (const dir of dirs) {
      logBlock = await exploreUntil(dir, 20, () => bot.findBlock({
        matching: block => treeTypes.includes(block.name),
        maxDistance: 32
      }));
      if (logBlock) break;
    }
  }
  if (!logBlock) return;
  const startWood = bot.inventory.items().filter(i => treeTypes.includes(i.name)).reduce((s, i) => s + i.count, 0);
  for (let i = 0; i < needed + 5; i++) {
    const nowWood = bot.inventory.items().filter(t => treeTypes.includes(t.name)).reduce((s, it) => s + it.count, 0);
    if (nowWood - startWood >= needed) break;
    const lb = bot.findBlock({
      matching: block => treeTypes.includes(block.name),
      maxDistance: 32
    });
    if (!lb) break;
    await mineBlock(lb.name, 1);
    await bot.waitForTicks(5);
  }
}