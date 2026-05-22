async function explore_north_for_52_blocks(bot) {
  const targetX = bot.entity.position.x;
  const targetZ = bot.entity.position.z - 52;
  const targetY = bot.entity.position.y;
  await exploreUntil('north', 25, () => {
    const ironIngot = bot.findBlock({
      matching: block => block.name === 'iron_ingot',
      maxDistance: 32
    });
    if (!ironIngot) { console.log("Block not found"); return; }
    if (ironIngot) return ironIngot.position;
    return null;
  });
}