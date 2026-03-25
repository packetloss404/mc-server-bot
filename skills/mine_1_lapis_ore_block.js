async function mineOneLapisOre(bot) {
  let lapisBlock = bot.findBlock({
    matching: block => block.name === 'lapis_ore' || block.name === 'deepslate_lapis_ore',
    maxDistance: 32
  });
  if (!lapisBlock) {
    await exploreUntil(bot, 'south', 60, () => {
      const found = bot.findBlock({
        matching: block => block.name === 'lapis_ore' || block.name === 'deepslate_lapis_ore',
        maxDistance: 32
      });
      return found;
    });
    lapisBlock = bot.findBlock({
      matching: block => block.name === 'lapis_ore' || block.name === 'deepslate_lapis_ore',
      maxDistance: 32
    });
  }
  if (lapisBlock) {
    await mineBlock(lapisBlock.name, 1);
  }
}