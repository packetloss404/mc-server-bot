async function explore_west_for_70_blocks(bot) {
  const targetX = bot.entity.position.x - 70;
  const targetZ = bot.entity.position.z;
  await moveTo(targetX, bot.entity.position.y, targetZ, 2, 60);
  await exploreUntil('x', 15, () => {
    const nearbyItem = bot.nearestEntity(e => e.type === 'object' && e.name === 'item' && e.metadata && e.metadata[8] && e.metadata[8].name === 'iron_ingot');
    if (!nearbyItem) { console.log("Entity not found"); return; }
    if (nearbyItem) return nearbyItem.position;
    const container = bot.findBlock({
      matching: b => ['chest', 'furnace', 'barrel', 'dispenser', 'dropper', 'hopper'].includes(b.name),
      maxDistance: 16
    });
    if (container) return container.position;
    return null;
  });
}