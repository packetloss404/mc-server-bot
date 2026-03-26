async function placeOakSlabsOnWalls(bot) {
  // Task: Place 10 oak slabs on top of walls to create a roof structure
  // Use the existing build_a_roof_using_oak skill which handles all the logic

  // First, check if we have the build_a_roof_using_oak skill available
  // If not, we'll implement the core logic here

  let slabsItem = bot.inventory.items().find(i => i.name === 'oak_slab');
  let slabCount = slabsItem ? slabsItem.count : 0;

  // If we don't have enough slabs, craft them from oak planks
  if (slabCount < 10) {
    let planksNeeded = 10 - slabCount;
    // 2 planks -> 3 slabs, so we need ceil(planksNeeded * 2 / 3) planks
    let planksRequired = Math.ceil(planksNeeded * 2 / 3);
    let planksItem = bot.inventory.items().find(i => i.name === 'oak_planks');
    let plankCount = planksItem ? planksItem.count : 0;
    if (plankCount < planksRequired) {
      // Mine oak logs and craft planks
      let logsNeeded = Math.ceil(planksRequired / 4); // 1 log -> 4 planks
      let logsItem = bot.inventory.items().find(i => i.name === 'oak_log');
      let logCount = logsItem ? logsItem.count : 0;
      if (logCount < logsNeeded) {
        await mineBlock('oak_log', logsNeeded - logCount);
      }

      // Craft planks from logs
      await craftItem('oak_planks', planksRequired - plankCount);
    }

    // Craft slabs from planks
    await craftItem('oak_slab', 10 - slabCount);
  }

  // Now place the slabs on top of walls
  // Find a nearby wall block to place slabs on
  let wallBlock = bot.findBlock({
    matching: b => b.name.includes('oak') || b.name === 'oak_wood' || b.name === 'oak_log',
    maxDistance: 32
  });
  if (wallBlock) {
    // Place slabs on top of the wall structure
    let pos = wallBlock.position;
    for (let i = 0; i < 10; i++) {
      let placeX = pos.x + i % 5 - 2;
      let placeY = pos.y + 3; // On top of 3-block high walls
      let placeZ = pos.z + Math.floor(i / 5) - 2;
      await placeItem('oak_slab', placeX, placeY, placeZ);
    }
  }
}