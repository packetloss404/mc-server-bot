async function mineOneLapisOre(bot) {
  const lapisBlocks = ['lapis_ore', 'deepslate_lapis_ore'];
  let targetBlock = bot.findBlock({
    matching: b => lapisBlocks.includes(b.name),
    maxDistance: 32
  });
  if (!targetBlock) {
    targetBlock = await exploreUntil(bot, 'south', 60, () => {
      return bot.findBlock({
        matching: b => lapisBlocks.includes(b.name),
        maxDistance: 32
      });
    });
  }
  if (targetBlock) {
    await mineBlock(targetBlock.name, 1);
  } else {
    throw new Error("Could not find any lapis ore after exploration.");
  }
}