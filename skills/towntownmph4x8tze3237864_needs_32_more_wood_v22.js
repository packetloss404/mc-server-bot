async function towntownmph4x8tze3237864_needs_32_more_wood(bot) {
  // Bot already has 68 oak_logs - task is likely to deposit at town chest
  // Find nearby chest/barrel
  let chest = bot.findBlock({
    matching: block => ['chest', 'barrel', 'trapped_chest'].includes(block.name),
    maxDistance: 32
  });
  if (!chest) {
    // Explore to find storage
    await exploreUntil('north', 15, () => {
      return bot.findBlock({
        matching: block => ['chest', 'barrel', 'trapped_chest'].includes(block.name),
        maxDistance: 32
      });
    });
    chest = bot.findBlock({
      matching: block => ['chest', 'barrel', 'trapped_chest'].includes(block.name),
      maxDistance: 32
    });
  }
  if (chest) {
    // Move to chest and deposit logs
    await moveTo(chest.position.x, chest.position.y, chest.position.z, 3, 10);
    const inv = bot.inventory.items();
    const logs = inv.filter(i => i.name === 'oak_log');
    if (logs.length > 0) {
      for (const log of logs) {
        await depositItem('chest', 'oak_log', log.count);
      }
    }
  }
}