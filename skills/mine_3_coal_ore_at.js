async function mine3CoalOreAt(bot) {
  let block = bot.findBlock({ matching: b => b.name === 'coal_ore' || b.name === 'deepslate_coal_ore', maxDistance: 64 });
  if (!block) {
    await exploreUntil({ x: 1, y: 0, z: 0 }, 60, () => bot.findBlock({ matching: b => b.name === 'coal_ore' || b.name === 'deepslate_coal_ore', maxDistance: 64 }));
    block = bot.findBlock({ matching: b => b.name === 'coal_ore' || b.name === 'deepslate_coal_ore', maxDistance: 64 });
  }
  if (!block) return;
  await moveTo(block.position.x, block.position.y, block.position.z, 2, 60);
  await mineBlock('coal_ore', 3);
}
