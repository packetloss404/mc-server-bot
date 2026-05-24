async function towntownmph4x8tze3237864_needs_32_more_wood(bot) {
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
    await moveTo(chest.position.x, chest.position.y + 1, chest.position.z, 2, 10);
    await depositItem(chest.name, 'oak_log', 32);
  }
}