async function mineLapisLazuliOre(bot) {
  let targetBlock = bot.findBlock({
    matching: block => block.name === 'lapis_ore' || block.name === 'deepslate_lapis_ore',
    maxDistance: 32
  });
  if (!targetBlock) {
    await exploreUntil('south', 60, () => {
      targetBlock = bot.findBlock({
        matching: block => block.name === 'lapis_ore' || block.name === 'deepslate_lapis_ore',
        maxDistance: 32
      });
      return !!targetBlock;
    });
  }
  if (targetBlock) {
    await mineBlock('lapis_lazuli', 1);
  }
}