async function mineIronOreAtTarget(bot) {
  const pickaxe = bot.inventory.items().find(i => i.name.includes('stone_pickaxe') || i.name.includes('iron_pickaxe') || i.name.includes('diamond_pickaxe'));
  if (pickaxe) {
    await bot.equip(pickaxe, 'hand');
  }
  let block = bot.findBlock({ matching: b => b.name === 'iron_ore' || b.name === 'deepslate_iron_ore', maxDistance: 64 });
  if (!block) {
    await exploreUntil({ x: 1, y: 0, z: 0 }, 60, () => bot.findBlock({ matching: b => b.name === 'iron_ore' || b.name === 'deepslate_iron_ore', maxDistance: 64 }));
    block = bot.findBlock({ matching: b => b.name === 'iron_ore' || b.name === 'deepslate_iron_ore', maxDistance: 64 });
  }
  if (!block) return;
  await moveTo(block.position.x, block.position.y, block.position.z, 2, 30);
  await mineBlock('iron_ore', 1);
}
