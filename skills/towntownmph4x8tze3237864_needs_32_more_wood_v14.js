async function towntownmph4x8tze3237864_needs_32_more_wood(bot) {
  // Bot has 12 oak_logs, needs 32 total = 20 more needed
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
        if (!oakBlock) { console.log("Block not found"); return; }
        return oakBlock ? oakBlock.position : null;
      });
      if (found) {
        await moveTo(found.x, found.y, found.z, 3, 10);
        const toMine = Math.min(needed, 20); // mine up to 20 at a time
        await mineBlock('oak_log', toMine);
        needed -= toMine;
      }
    }
  }

  // Find and deposit to town chest
  let chest = bot.findBlock({
    matching: block => ['chest', 'barrel', 'trapped_chest'].includes(block.name),
    maxDistance: 32
  });
  if (!chest) {
    for (const dir of ['north', 'east', 'south', 'west']) {
      chest = await exploreUntil(dir, 15, () => bot.findBlock({
        matching: block => ['chest', 'barrel', 'trapped_chest'].includes(block.name),
        maxDistance: 32
      }));
      if (chest) break;
    }
  }
  if (chest) {
    await moveTo(chest.position.x, chest.position.y, chest.position.z, 3, 10);
    await depositItem(chest.name, 'oak_log', 32);
  }
}