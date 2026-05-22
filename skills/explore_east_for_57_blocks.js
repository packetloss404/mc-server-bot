async function explore_east_for_57_blocks(bot) {
  const currentPos = bot.entity.position;
  const targetX = currentPos.x + 57;

  // Explore east until we find iron_ore
  await exploreUntil('east', 30, () => {
    const ironOre = bot.findBlock({
      matching: block => block.name === 'iron_ore',
      maxDistance: 32
    });
    if (!ironOre) { console.log("Block not found"); return; }
    return ironOre;
  });
}