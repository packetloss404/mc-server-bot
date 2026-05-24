async function seekShelterAndSleepThrough(bot) {
  const pos = bot.entity.position;

  // Check current inventory
  const inv = bot.inventory.items();
  let dirtCount = inv.find(i => i.name === 'dirt')?.count || 0;
  let planksCount = inv.find(i => i.name === 'oak_planks')?.count || 0;
  let wool = inv.find(i => i.name === 'white_wool');
  let bedItem = inv.find(i => i.name?.includes('bed'));

  // If no bed, need to craft one (3 wool + 3 planks)
  if (!bedItem) {
    if (!wool) {
      // Kill a sheep for wool
      const sheep = bot.nearestEntity(e => e.name === 'sheep' && e.position.distanceTo(pos) < 32);
      if (sheep) {
        await moveTo(sheep.position.x, sheep.position.y, sheep.position.z, 2, 10);
        await killMob('sheep', 10000);
      } else {
        // Find sheep by exploring
        await exploreUntil('north', 15, () => bot.nearestEntity(e => e.name === 'sheep'));
        const newSheep = bot.nearestEntity(e => e.name === 'sheep');
        if (!newSheep) { console.log("Entity not found"); return; }
        if (newSheep) {
          await moveTo(newSheep.position.x, newSheep.position.y, newSheep.position.z, 2, 10);
          await killMob('sheep', 10000);
        }
      }
      // Refresh inventory after killing sheep
      await bot.waitForTicks(5);
    }

    // Now we should have wool, craft bed
    const invAfter = bot.inventory.items();
    wool = invAfter.find(i => i.name === 'white_wool');
    const planks = invAfter.find(i => i.name === 'oak_planks');
    if (wool && wool.count >= 3 && planks && planks.count >= 3) {
      await craftItem('bed', 1);
    }
  }

  // Refresh inventory
  const invFinal = bot.inventory.items();
  dirtCount = invFinal.find(i => i.name === 'dirt')?.count || 0;

  // Gather more dirt if needed (need ~10-20 for shelter)
  if (dirtCount < 10) {
    // Find dirt nearby
    let dirtBlock = bot.findBlock({
      matching: b => b.name === 'dirt',
      maxDistance: 16
    });
    if (!dirtBlock) {
      await exploreUntil('north', 20, () => bot.findBlock({
        matching: b => b.name === 'dirt',
        maxDistance: 32
      }));
      dirtBlock = bot.findBlock({
        matching: b => b.name === 'dirt',
        maxDistance: 32
      });
    }
    if (dirtBlock) {
      await mineBlock('dirt', 15);
    }
  }

  // Build a small 3x3x2 shelter at current position
  // Build walls (not where bot is standing - build around it)
  const groundY = Math.floor(pos.y);

  // Build a 3x3x2 enclosure, leaving the bot inside
  // Build 4 corner pillars + walls
  const buildPositions = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = 0; dy < 2; dy++) {
        // Skip center (where bot is) and floor
        if (dx === 0 && dz === 0) continue;
        buildPositions.push({
          x: Math.floor(pos.x) + dx,
          y: groundY + dy,
          z: Math.floor(pos.z) + dz
        });
      }
    }
  }

  // Get dirt to hand for building
  const dirt = bot.inventory.items().find(i => i.name === 'dirt');
  if (dirt) {
    await bot.equip(dirt, 'hand');
    for (const bp of buildPositions) {
      const block = bot.blockAt(bp);
      if (block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') {
        await placeItem('dirt', bp.x, bp.y, bp.z);
        await bot.waitForTicks(3);
      }
    }
  }

  // Place bed near bot (at edge of shelter)
  const bed = bot.inventory.items().find(i => i.name?.includes('bed'));
  if (bed) {
    await bot.equip(bed, 'hand');
    // Place bed at edge of shelter, not blocking door
    const bedPos = {
      x: Math.floor(pos.x) - 1,
      y: groundY,
      z: Math.floor(pos.z)
    };
    await placeItem('bed', bedPos.x, bedPos.y, bedPos.z);
    await bot.waitForTicks(5);
  }

  // Sleep in the bed
  const bedPlaced = bot.blockAt(bot.entity.position.offset(-1, 0, 0));
  if (bedPlaced && bedPlaced.name?.includes('bed')) {
    // Right-click the bed to sleep
    await bot.look(bot.entity.yaw, 0);
    await bot.waitForTicks(5);
    // Use the bed
    const bedToSleep = bot.inventory.items().find(i => i.name?.includes('bed'));
    if (bedToSleep) {
      await bot.equip(bedToSleep, 'hand');
    }
    // Try to sleep - mineflayer uses bot.sleep()
    if (bot.isInWater || bot.isInLava) {
      // If in water, swim to surface first
      const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
      if (bot.blockAt(eyePos)?.name.includes('water')) {
        bot.setControlState('jump', true);
        bot.setControlState('forward', true);
        await bot.waitForTicks(40);
        bot.clearControlStates();
      }
    }
    await bot.sleep();
  }
}