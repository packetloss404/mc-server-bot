async function mine_the_new_ironingot_deposit(bot) {
  // iron_ingot_deposit doesn't exist as a block - actual block is iron_ore
  const ironOre = bot.findBlock({
    matching: b => b.name === 'iron_ore',
    maxDistance: 32
  });
  if (!ironOre) {
    await exploreUntil('north', 30, () => bot.findBlock({
      matching: b => b.name === 'iron_ore',
      maxDistance: 32
    }));
  }
  await mineBlock('iron_ore', 1);
}