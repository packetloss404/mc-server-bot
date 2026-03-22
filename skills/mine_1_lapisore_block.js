async function mineOneLapisOre(bot) {
  const targetBlock = 'lapis_ore';
  const count = 1;
  let lapis = bot.findBlock({
    matching: b => b.name === targetBlock,
    maxDistance: 32
  });
  if (!lapis) {
    lapis = await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === targetBlock,
        maxDistance: 32
      });
    });
  }
  if (lapis) {
    await mineBlock(targetBlock, count);
  }
}