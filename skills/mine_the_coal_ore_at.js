async function mineCoalOreAtTarget(bot) {
  const pickaxe = bot.inventory.items().find(i => i.name.includes('pickaxe'));
  if (pickaxe) {
    await bot.equip(pickaxe, 'hand');
  }
  let block = bot.findBlock({ matching: b => b.name === 'coal_ore' || b.name === 'deepslate_coal_ore', maxDistance: 64 });
  if (!block) {
    await exploreUntil({ x: 1, y: 0, z: 0 }, 60, () => bot.findBlock({ matching: b => b.name === 'coal_ore' || b.name === 'deepslate_coal_ore', maxDistance: 64 }));
    block = bot.findBlock({ matching: b => b.name === 'coal_ore' || b.name === 'deepslate_coal_ore', maxDistance: 64 });
  }
  if (!block) return;
  await moveTo(block.position.x, block.position.y, block.position.z, 4, 30);
  await mineBlock('coal_ore', 1);
}
