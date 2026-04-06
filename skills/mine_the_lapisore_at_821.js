async function mineLapisOreAtPosition(bot) {
  const targetX = 821;
  const targetY = 49;
  const targetZ = 235;
  const pickaxe = bot.inventory.items().find(i => i.name.includes('stone_pickaxe') || i.name.includes('iron_pickaxe') || i.name.includes('diamond_pickaxe') || i.name.includes('netherite_pickaxe'));
  if (pickaxe) {
    await bot.equip(pickaxe, 'hand');
  }
  await moveTo(targetX, targetY, targetZ, 2, 60);
  const lapisBlock = bot.findBlock({
    matching: b => b.name === 'lapis_ore' || b.name === 'deepslate_lapis_ore',
    maxDistance: 32
  });
  if (lapisBlock) {
    await mineBlock(lapisBlock.name, 1);
  } else {
    const foundOre = await exploreUntil('horizontal', 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'lapis_ore' || b.name === 'deepslate_lapis_ore',
        maxDistance: 32
      });
    });
    if (foundOre) {
      await mineBlock(foundOre.name, 1);
    }
  }
}