async function towntownmph4x8tze3237864_needs_32_more_wood(bot) {
  // Check current oak log count
  let inv = bot.inventory.items();
  let currentOak = inv.filter(i => i.name === 'oak_log').reduce((s, i) => s + i.count, 0);
  let needed = Math.max(0, 32 - currentOak);
  if (needed > 0) {
    // Find and mine oak logs
    const directions = ['north', 'east', 'south', 'west'];
    for (const dir of directions) {
      if (needed <= 0) break;
      const found = await exploreUntil(dir, 15, async () => {
        const oakBlock = bot.findBlock({
          matching: b => b.name === 'oak_log',
          maxDistance: 32
        });
        if (!oakBlock) return null;
        return oakBlock.position;
      });
      if (found) {
        await mineBlock('oak_log', needed);
        inv = bot.inventory.items();
        currentOak = inv.filter(i => i.name === 'oak_log').reduce((s, i) => s + i.count, 0);
        needed = Math.max(0, 32 - currentOak);
      }
    }
  }

  // Find chest and deposit
  let chest = bot.findBlock({
    matching: block => ['chest', 'barrel', 'trapped_chest'].includes(block.name),
    maxDistance: 32
  });
  if (!chest) {
    const directions = ['north', 'east', 'south', 'west'];
    for (const dir of directions) {
      chest = await exploreUntil(dir, 15, () => bot.findBlock({
        matching: block => ['chest', 'barrel', 'trapped_chest'].includes(block.name),
        maxDistance: 32
      }));
      if (chest) break;
    }
  }
  if (chest) {
    await moveTo(chest.position.x, chest.position.y, chest.position.z, 3, 10);
    inv = bot.inventory.items();
    const toDeposit = Math.min(32, inv.filter(i => i.name === 'oak_log').reduce((s, i) => s + i.count, 0));
    if (toDeposit > 0) {
      await depositItem(chest.name, 'oak_log', toDeposit);
    }
  }
}