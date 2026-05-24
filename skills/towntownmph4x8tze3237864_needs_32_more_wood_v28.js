async function towntownmph4x8tze3237864_needs_32_more_wood(bot) {
  const inv = bot.inventory.items();
  const currentWood = inv.find(i => i.name === 'spruce_log')?.count || 0;
  const needed = 32;

  // Find nearby spruce log
  let treeBlock = bot.findBlock({
    matching: b => b.name === 'spruce_log',
    maxDistance: 32
  });
  if (!treeBlock) {
    // Explore to find spruce trees
    treeBlock = await exploreUntil('north', 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'spruce_log',
        maxDistance: 32
      });
    });
  }
  if (treeBlock) {
    await moveTo(treeBlock.position.x, treeBlock.position.y, treeBlock.position.z, 3, 15);
    await mineBlock('spruce_log', needed);
  }
}