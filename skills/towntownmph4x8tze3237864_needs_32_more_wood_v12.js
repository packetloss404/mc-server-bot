async function towntownmph4x8tze3237864_needs_32_more_wood(bot) {
  const logTypes = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log'];

  // Find and mine logs until we have 32
  for (let i = 0; i < 32; i++) {
    const inv = bot.inventory.items();
    const currentLogs = inv.filter(item => logTypes.includes(item.name));
    const logCount = currentLogs.reduce((sum, item) => sum + item.count, 0);
    if (logCount >= 32) break;

    // Find a nearby log
    let logBlock = bot.findBlock({
      matching: block => logTypes.includes(block.name),
      maxDistance: 32
    });

    // If no log nearby, explore to find trees
    if (!logBlock) {
      const directions = ['north', 'east', 'south', 'west'];
      for (const dir of directions) {
        logBlock = await exploreUntil(dir, 20, () => bot.findBlock({
          matching: block => logTypes.includes(block.name),
          maxDistance: 32
        }));
        if (logBlock) break;
      }
    }
    if (logBlock) {
      await mineBlock(logBlock.name, 1);
    } else {
      break;
    }
  }

  // Find chest and deposit logs
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
    const inv = bot.inventory.items();
    for (const item of inv) {
      if (logTypes.includes(item.name)) {
        await depositItem(chest.name, item.name, item.count);
      }
    }
  }
}