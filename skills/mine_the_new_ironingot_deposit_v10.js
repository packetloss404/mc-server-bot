async function mine_the_new_ironingot_deposit(bot) {
  await swimToTheSurfaceDrowning(bot);

  // iron_ingot_deposit doesn't exist in vanilla - use nearby iron_ore
  const ironOre = bot.findBlock({
    matching: block => block.name === 'iron_ore',
    maxDistance: 32
  });
  if (!ironOre) { console.log("Block not found"); return; }
  if (ironOre) {
    await mineBlock('iron_ore', 1);
  }
}