async function mine1OakLogAt(bot) {
  let block = bot.findBlock({ matching: b => b.name === 'oak_log', maxDistance: 64 });
  if (!block) {
    await exploreUntil({ x: 1, y: 0, z: 0 }, 60, () => bot.findBlock({ matching: b => b.name === 'oak_log', maxDistance: 64 }));
    block = bot.findBlock({ matching: b => b.name === 'oak_log', maxDistance: 64 });
  }
  if (!block) return;
  await moveTo(block.position.x, block.position.y, block.position.z, 2, 30);
  await mineBlock('oak_log', 1);
}
