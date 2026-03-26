async function buildFourWallsHeightFour(bot) {
  // Task: Build 4 walls of oak planks to height of 4 blocks forming a rectangular house frame
  // We need 80 oak planks total (4 walls × 5 blocks per wall × 4 blocks high)
  // Wall structure: 5 blocks wide, 5 blocks deep, 4 blocks high = (5+5+5+5) × 4 = 80 planks

  let planksItem = bot.inventory.items().find(i => i.name === 'oak_planks');
  let plankCount = planksItem ? planksItem.count : 0;

  // Need 80 oak planks for 4 walls of 4 blocks high
  if (plankCount < 80) {
    let logsItem = bot.inventory.items().find(i => i.name === 'oak_log');
    let logCount = logsItem ? logsItem.count : 0;

    // Need 20 logs to make 80 planks (1 log = 4 planks)
    const logsNeeded = Math.ceil((80 - plankCount) / 4);
    if (logCount < logsNeeded) {
      // Find and mine oak logs
      let logBlock = bot.findBlock({
        matching: b => b.name === 'oak_log',
        maxDistance: 32
      });
      if (!logBlock) {
        logBlock = await exploreUntil('forward', 60000, () => bot.findBlock({
          matching: b => b.name === 'oak_log',
          maxDistance: 32
        }));
      }
      await mineBlock('oak_log', logsNeeded - logCount);
    }

    // Craft oak planks
    await craftItem('oak_planks', 80 - plankCount);
  }

  // Build 4 walls at height 4 blocks in a 5×5 rectangular frame
  const startPos = bot.entity.position;
  const baseX = Math.floor(startPos.x);
  const baseY = Math.floor(startPos.y);
  const baseZ = Math.floor(startPos.z);

  // Wall 1: North wall (z constant, x varies)
  for (let h = 0; h < 4; h++) {
    for (let x = 0; x < 5; x++) {
      await placeItem('oak_planks', baseX + x, baseY + h, baseZ);
    }
  }

  // Wall 2: South wall (z+4, x varies)
  for (let h = 0; h < 4; h++) {
    for (let x = 0; x < 5; x++) {
      await placeItem('oak_planks', baseX + x, baseY + h, baseZ + 4);
    }
  }

  // Wall 3: East wall (x+4, z varies)
  for (let h = 0; h < 4; h++) {
    for (let z = 0; z < 5; z++) {
      await placeItem('oak_planks', baseX + 4, baseY + h, baseZ + z);
    }
  }

  // Wall 4: West wall (x constant, z varies)
  for (let h = 0; h < 4; h++) {
    for (let z = 0; z < 5; z++) {
      await placeItem('oak_planks', baseX, baseY + h, baseZ + z);
    }
  }
}