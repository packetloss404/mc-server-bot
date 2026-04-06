async function mineLapisOreAt956(bot) {
  const pickaxe = bot.inventory.items().find(i => i.name.includes('stone_pickaxe') || i.name.includes('iron_pickaxe') || i.name.includes('diamond_pickaxe'));
  if (pickaxe) {
    await bot.equip(pickaxe, 'hand');
  }
  const targetX = 956;
  const targetY = 43;
  const targetZ = 368;
  await moveTo(targetX, targetY, targetZ, 2, 60);
  const lapisBlock = bot.findBlock({
    matching: b => b.name === 'lapis_ore' || b.name === 'deepslate_lapis_ore',
    maxDistance: 32
  });
  if (lapisBlock) {
    await mineBlock(lapisBlock.name, 1);
  } else {
    await exploreUntil('horizontal', 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'lapis_ore' || b.name === 'deepslate_lapis_ore',
        maxDistance: 32
      });
    });
    const foundOre = bot.findBlock({
      matching: b => b.name === 'lapis_ore' || b.name === 'deepslate_lapis_ore',
      maxDistance: 32
    });
    if (foundOre) {
      await mineBlock(foundOre.name, 1);
    }
  }
}