async function mineTheNewIroningotDeposit(bot) {
  await swimToTheSurfaceDrowning(bot);
  const ironOre = bot.findBlock({
    matching: block => block.name === 'iron_ore',
    maxDistance: 32
  });
  if (!ironOre) { console.log("Block not found"); return; }
  if (ironOre) {
    await mineBlock('iron_ore', 1);
  } else {
    await exploreUntil('south', 25, () => {
      const found = bot.findBlock({
        matching: block => block.name === 'iron_ore',
        maxDistance: 32
      });
      if (!found) { console.log("Block not found"); return; }
      return found || null;
    });
    await mineBlock('iron_ore', 1);
  }
}