async function mine3IronOreAt968(bot) {
  const pickaxe = bot.inventory.items().find(i => i.name.endsWith('_pickaxe'));
  if (pickaxe) {
    await bot.equip(pickaxe, 'hand');
  }
  let ironOre = bot.findBlock({
    matching: b => b.name === 'iron_ore' || b.name === 'deepslate_iron_ore',
    maxDistance: 32
  });
  if (!ironOre) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === 'iron_ore' || b.name === 'deepslate_iron_ore',
        maxDistance: 32
      });
    });
    ironOre = bot.findBlock({
      matching: b => b.name === 'iron_ore' || b.name === 'deepslate_iron_ore',
      maxDistance: 32
    });
  }
  if (ironOre) {
    await mineBlock(ironOre.name, 3);
  }
}