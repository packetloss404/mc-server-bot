async function mine_the_new_ironingot_deposit(bot) {
  const ironOreBlock = bot.findBlock({
    matching: block => block.name === 'iron_ore',
    maxDistance: 32
  });
  if (!ironOreBlock) { console.log("Block not found"); return; }
  if (ironOreBlock) {
    await mineBlock('iron_ore', 1);
  } else {
    await exploreUntil('down', 15, () => bot.findBlock({
      matching: block => block.name === 'iron_ore',
      maxDistance: 32
    }));
    const foundOre = bot.findBlock({
      matching: block => block.name === 'iron_ore',
      maxDistance: 32
    });
    if (!foundOre) { console.log("Block not found"); return; }
    if (foundOre) {
      await mineBlock('iron_ore', 1);
    }
  }
}