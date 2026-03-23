async function mineOneSugarCane(bot) {
  let sugarCane = bot.findBlock({
    matching: b => b.name === 'sugar_cane',
    maxDistance: 32
  });
  if (!sugarCane) {
    await exploreUntil('east', 60, () => {
      return bot.findBlock({
        matching: b => b.name === 'sugar_cane',
        maxDistance: 32
      });
    });
  }
  await mineBlock('sugar_cane', 1);
}