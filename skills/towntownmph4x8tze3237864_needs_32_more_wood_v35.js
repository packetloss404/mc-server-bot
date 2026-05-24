async function towntownmph4x8tze3237864_needs_32_more_wood(bot) {
  // Explore to find oak trees
  const treeBlock = await exploreUntil('forward', 30, () => {
    return bot.findBlock({
      matching: b => b.name.includes('log'),
      maxDistance: 32
    });
  });
  if (!treeBlock) {
    // Try all directions
    const dirs = ['north', 'south', 'east', 'west'];
    for (const dir of dirs) {
      const found = await exploreUntil(dir, 25, () => {
        return bot.findBlock({
          matching: b => b.name.includes('log'),
          maxDistance: 32
        });
      });
      if (found) {
        treeBlock = found;
        break;
      }
    }
  }
  if (treeBlock) {
    // Move to the tree and mine 32 oak logs
    await moveTo(treeBlock.position.x, treeBlock.position.y, treeBlock.position.z, 3, 15);
    await mineBlock('oak_log', 32);
  }
}