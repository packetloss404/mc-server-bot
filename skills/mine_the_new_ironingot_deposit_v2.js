async function mineTheNewIroningotDeposit(bot) {
  let ironOre = bot.findBlock({
    matching: b => b.name === 'iron_ore',
    maxDistance: 32
  });
  if (!ironOre) {
    await exploreUntil('north', 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'iron_ore',
        maxDistance: 32
      });
    });
    ironOre = bot.findBlock({
      matching: b => b.name === 'iron_ore',
      maxDistance: 32
    });
  }
  if (ironOre) {
    await mineBlock('iron_ore', 1);
  }
}