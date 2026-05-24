async function towntownmph4x8tze3237864_needs_32_more_wood(bot) {
  const inv = bot.inventory.items();
  const logTypes = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'dark_oak_log', 'acacia_log'];
  const logs = inv.filter(i => logTypes.includes(i.name));
  const totalLogs = logs.reduce((sum, i) => sum + i.count, 0);
  if (totalLogs >= 32) {
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
      await moveTo(chest.position.x, chest.position.y + 1, chest.position.z, 2, 10);
      await depositItem(chest.name, 'oak_log', 32);
    }
  }
}