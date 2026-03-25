async function mineLapisOreNearby(bot) {
  let lapis = bot.findBlock({
    matching: b => b.name === 'lapis_ore' || b.name === 'deepslate_lapis_ore',
    maxDistance: 32
  });
  if (!lapis) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === 'lapis_ore' || b.name === 'deepslate_lapis_ore',
        maxDistance: 32
      });
    });
    lapis = bot.findBlock({
      matching: b => b.name === 'lapis_ore' || b.name === 'deepslate_lapis_ore',
      maxDistance: 32
    });
  }
  if (lapis) {
    await mineBlock(lapis.name, 1);
  }
}