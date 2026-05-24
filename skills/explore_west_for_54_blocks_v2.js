async function explore_west_for_54_blocks(bot) {
  const targetX = bot.entity.position.x - 54;
  await exploreUntil('west', 25, () => {
    const ingot = bot.findBlock({
      matching: b => b.name === 'iron_ingot',
      maxDistance: 32
    });
    if (!ingot) { console.log("Block not found"); return; }
    if (ingot) return ingot.position;
    return null;
  });
}