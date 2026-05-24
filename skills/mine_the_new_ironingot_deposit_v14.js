async function mine_the_new_ironingot_deposit(bot) {
  // First swim to surface if drowning
  await swimToTheSurfaceDrowning(bot);

  // Find nearby iron_ore (iron_ingot_deposit doesn't exist - use iron_ore)
  const ironOre = bot.findBlock({
    matching: block => block.name === 'iron_ore',
    maxDistance: 32
  });
  if (!ironOre) {
    // Explore to find iron ore
    await exploreUntil('north', 15, () => bot.findBlock({
      matching: b => b.name === 'iron_ore',
      maxDistance: 32
    }));
  }

  // Mine the iron_ore
  await mineBlock('iron_ore', 1);
}