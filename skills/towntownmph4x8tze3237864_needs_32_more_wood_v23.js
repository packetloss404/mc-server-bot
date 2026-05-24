async function towntownmph4x8tze3237864_needs_32_more_wood(bot) {
  const inv = bot.inventory.items();
  const currentOak = inv.find(i => i.name === 'oak_log')?.count || 0;
  const currentBirch = inv.find(i => i.name === 'birch_log')?.count || 0;
  const currentWood = currentOak + currentBirch;
  const neededWood = Math.max(0, 32 - currentWood);
  if (neededWood > 0) {
    const treeBlock = bot.findBlock({
      matching: block => ['oak_log', 'birch_log'].includes(block.name),
      maxDistance: 32
    });
    if (treeBlock) {
      await mineBlock(treeBlock.name, Math.min(neededWood, 4));
    }
  }
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
    const oakToDeposit = bot.inventory.items().find(i => i.name === 'oak_log')?.count || 0;
    const birchToDeposit = bot.inventory.items().find(i => i.name === 'birch_log')?.count || 0;
    if (oakToDeposit > 0) await depositItem(chest.name, 'oak_log', oakToDeposit);
    if (birchToDeposit > 0) await depositItem(chest.name, 'birch_log', birchToDeposit);
  }
}