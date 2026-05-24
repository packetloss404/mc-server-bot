async function explore_west_for_55_blocks(bot) {
  const targetX = bot.entity.position.x - 55;
  const targetZ = bot.entity.position.z;

  // Move west 55 blocks
  await moveTo(targetX, bot.entity.position.y, targetZ, 2, 60);

  // Explore the area to find iron_ingot (as dropped item or in containers)
  await exploreUntil('x', 15, () => {
    // Check for dropped iron_ingot nearby
    const nearbyItem = bot.nearestEntity(e => e.type === 'object' && e.name === 'item' && e.metadata && e.metadata[8] && e.metadata[8].name === 'iron_ingot');
    if (!nearbyItem) { console.log("Entity not found"); return; }
    if (nearbyItem) return nearbyItem.position;

    // Check for iron_ingot in nearby containers
    const container = bot.findBlock({
      matching: b => ['chest', 'furnace', 'barrel', 'dispenser', 'dropper', 'hopper'].includes(b.name),
      maxDistance: 16
    });
    if (container) {
      return container.position;
    }
    return null;
  });
}