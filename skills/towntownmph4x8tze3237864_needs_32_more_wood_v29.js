async function towntownmph4x8tze3237864_needs_32_more_wood(bot) {
  const inv = bot.inventory.items();
  const currentWood = inv.find(i => i.name === 'spruce_log')?.count || 0;
  const needed = Math.max(0, 32 - currentWood);
  if (needed <= 0) return;

  // Find nearby spruce log
  let treeBlock = bot.findBlock({
    matching: b => b.name === 'spruce_log',
    maxDistance: 16
  });
  if (!treeBlock) {
    treeBlock = await exploreUntil('forward', 25, () => {
      return bot.findBlock({
        matching: b => b.name === 'spruce_log',
        maxDistance: 20
      });
    });
  }
  if (!treeBlock) {
    const dirs = ['north', 'south', 'east', 'west'];
    for (const dir of dirs) {
      const found = await exploreUntil(dir, 20, () => {
        return bot.findBlock({
          matching: b => b.name === 'spruce_log',
          maxDistance: 20
        });
      });
      if (found) {
        treeBlock = found;
        break;
      }
    }
  }
  if (treeBlock) {
    // Move to the tree at eye level
    const pos = treeBlock.position;
    await moveTo(pos.x, pos.y, pos.z, 2, 20);

    // Mine the needed logs
    await mineBlock('spruce_log', needed);
  }
}