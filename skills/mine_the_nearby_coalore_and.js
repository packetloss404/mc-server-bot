async function mineCoalAndCopperOre(bot) {
  const coalOre = bot.findBlock({
    matching: block => block.name === 'coal_ore' || block.name === 'deepslate_coal_ore',
    maxDistance: 32
  });
  if (coalOre) {
    await mineBlock(coalOre.name, 1);
  } else {
    await exploreUntil(new Vec3(1, 0, 0), 60, () => bot.findBlock({
      matching: block => block.name === 'coal_ore' || block.name === 'deepslate_coal_ore',
      maxDistance: 32
    }));
    const foundCoal = bot.findBlock({
      matching: block => block.name === 'coal_ore' || block.name === 'deepslate_coal_ore',
      maxDistance: 32
    });
    if (foundCoal) await mineBlock(foundCoal.name, 1);
  }
  const copperOre = bot.findBlock({
    matching: block => block.name === 'copper_ore' || block.name === 'deepslate_copper_ore',
    maxDistance: 32
  });
  if (copperOre) {
    await mineBlock(copperOre.name, 1);
  } else {
    await exploreUntil(new Vec3(0, 0, 1), 60, () => bot.findBlock({
      matching: block => block.name === 'copper_ore' || block.name === 'deepslate_copper_ore',
      maxDistance: 32
    }));
    const foundCopper = bot.findBlock({
      matching: block => block.name === 'copper_ore' || block.name === 'deepslate_copper_ore',
      maxDistance: 32
    });
    if (foundCopper) await mineBlock(foundCopper.name, 1);
  }
}