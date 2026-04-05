async function mine3CoalOreAt97(bot) {
  let targetBlock = bot.findBlock({
    matching: b => ['coal_ore', 'deepslate_coal_ore'].includes(b.name),
    maxDistance: 32
  });
  if (!targetBlock) {
    targetBlock = await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => ['coal_ore', 'deepslate_coal_ore'].includes(b.name),
        maxDistance: 32
      });
    });
  }
  if (targetBlock) {
    await mineBlock(targetBlock.name, 3);
  }
}