async function mineIronOreAt955(bot) {
  const pickaxe = bot.inventory.items().find(i => i.name.includes('pickaxe'));
  if (pickaxe) {
    await bot.equip(pickaxe, 'hand');
  }
  const targetX = 955;
  const targetY = 45;
  const targetZ = 368;
  await moveTo(targetX, targetY, targetZ, 2, 60);
  const ironBlock = bot.findBlock({
    matching: b => b.name === 'iron_ore' || b.name === 'deepslate_iron_ore',
    maxDistance: 32
  });
  if (ironBlock) {
    await mineBlock(ironBlock.name, 1);
  } else {
    await exploreUntil('horizontal', 30, () => {
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