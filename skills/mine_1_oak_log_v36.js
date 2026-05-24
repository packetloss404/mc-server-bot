async function mine1OakLog(bot) {
  const inv = bot.inventory.items();
  const hasOakLog = inv.find(i => i.name === 'oak_log');
  if (hasOakLog) return;
  let oakLogBlock = bot.findBlock({
    matching: b => b.name === 'oak_log',
    maxDistance: 32
  });
  if (!oakLogBlock) {
    await exploreUntil('north', 30, () => bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    }));
    oakLogBlock = bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    });
  }
  if (oakLogBlock) {
    await moveTo(oakLogBlock.position.x, oakLogBlock.position.y - 1, oakLogBlock.position.z, 2, 10);
    await mineBlock('oak_log', 1);
  } else {
    throw new Error('Could not find oak_log even after exploring.');
  }
}