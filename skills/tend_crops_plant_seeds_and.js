async function tend_crops_plant_seeds_and(bot) {
  // First, explore to find farmland
  const farmland = await exploreUntil('forward', 30, () => {
    return bot.findBlock({
      matching: b => b.name === 'farmland',
      maxDistance: 32
    });
  });
  if (!farmland) {
    return; // No farmland found
  }

  // Move to farmland area
  await moveTo(farmland.position.x, farmland.position.y + 1, farmland.position.z, 3, 15);

  // Harvest any mature wheat first (mature wheat is stage 7)
  const nearbyWheat = bot.findBlocks({
    matching: b => b.name === 'wheat',
    maxDistance: 5,
    count: 64
  });
  for (const wheatBlock of nearbyWheat) {
    const properties = wheatBlock.getProperties();
    if (properties && properties.age >= 7) {
      await mineBlock('wheat', 1);
    }
  }

  // Check if we have wheat seeds now
  const inv = bot.inventory.items();
  const seeds = inv.find(i => i.name === 'wheat_seeds');
  if (seeds && seeds.count > 0) {
    // Find empty farmland adjacent to water
    const waterNearby = bot.findBlock({
      matching: b => b.name === 'water',
      maxDistance: 5
    });
    if (!waterNearby) { console.log("Block not found"); return; }
    if (waterNearby) {
      // Find dirt/grass blocks to till near water
      const positions = [waterNearby.position.offset(1, 0, 0), waterNearby.position.offset(-1, 0, 0), waterNearby.position.offset(0, 0, 1), waterNearby.position.offset(0, 0, -1), waterNearby.position.offset(2, 0, 0), waterNearby.position.offset(-2, 0, 0)];
      for (const pos of positions) {
        const block = bot.blockAt(pos);
        if (block && (block.name === 'dirt' || block.name === 'grass_block')) {
          const above = bot.blockAt(pos.offset(0, 1, 0));
          if (above && above.name === 'air') {
            await moveTo(pos.x, pos.y + 1, pos.z, 2, 10);
            await placeItem('wheat_seeds', pos.x, pos.y, pos.z);
            break;
          }
        }
      }
    }
  }
}