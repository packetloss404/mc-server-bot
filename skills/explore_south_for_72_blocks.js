async function explore_south_for_72_blocks(bot) {
  await exploreUntil('south', 20, () => {
    const target = bot.findBlock({
      matching: block => block.name === 'iron_ore',
      maxDistance: 32
    });
    if (!target) { console.log("Block not found"); return; }
    return target || false;
  });
  const ironOre = bot.findBlock({
    matching: block => block.name === 'iron_ore',
    maxDistance: 32
  });
  if (!ironOre) { console.log("Block not found"); return; }
  if (ironOre) {
    await mineBlock('iron_ore', 1);
  }
}