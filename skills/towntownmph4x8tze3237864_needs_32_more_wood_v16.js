async function towntownmph4x8tze3237864_needs_32_more_wood(bot) {
  let inv = bot.inventory.items();
  let oakLogs = inv.find(i => i.name === 'oak_log');
  if (!oakLogs || oakLogs.count < 32) return;
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
    await depositItem(chest.name, 'oak_log', 32);
  }
}