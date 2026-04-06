async function mineIronOreAtSpecificLocation(bot) {
  const pickaxe = bot.inventory.items().find(i => i.name.includes('pickaxe'));
  if (pickaxe) {
    await bot.equip(pickaxe, 'hand');
  }
  await moveTo(945, 48, 363, 3, 60);
  const ironOre = bot.findBlock({
    matching: b => b.name === 'iron_ore' || b.name === 'deepslate_iron_ore',
    maxDistance: 32
  });
  if (ironOre) {
    await mineBlock(ironOre.name, 1);
  } else {
    await exploreUntil('north', 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'iron_ore' || b.name === 'deepslate_iron_ore',
        maxDistance: 32
      });
    });
    const foundOre = bot.findBlock({
      matching: b => b.name === 'iron_ore' || b.name === 'deepslate_iron_ore',
      maxDistance: 32
    });
    if (foundOre) {
      await mineBlock(foundOre.name, 1);
    }
  }
}