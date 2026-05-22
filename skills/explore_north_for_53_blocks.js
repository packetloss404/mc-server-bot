async function explore_north_for_53_blocks(bot) {
  const targetX = bot.entity.position.x;
  const targetZ = bot.entity.position.z - 53;
  const targetY = bot.entity.position.y;

  // Explore north for 53 blocks, scanning for iron_ingot
  const found = await exploreUntil('north', 30, (entity, block) => {
    // Scan for iron_ingot nearby (from entities like item drops)
    if (entity && entity.name === 'iron_ingot') return entity.position;
    // Also check if iron ingot is in a nearby container
    const nearbyBlock = bot.findBlock({
      matching: b => b.name === 'furnace' || b.name === 'chest' || b.name === 'barrel',
      maxDistance: 5
    });
    if (!nearbyBlock) { console.log("Block not found"); return; }
    return false;
  });

  // If explore found something, move there
  if (found) {
    await moveTo(found.x, found.y, found.z, 2, 10);
  } else {
    // Fallback: just move north 53 blocks as a waypoint
    await moveTo(targetX, targetY, targetZ, 2, 20);
  }
}