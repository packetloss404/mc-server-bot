async function seekShelterUrgentlyRainyNight(bot) {
  // 1. Gather materials if needed (need about 20 blocks for a 3x3x3 enclosure)
  const dirtCount = bot.inventory.items().filter(i => i.name === 'dirt').reduce((acc, i) => acc + i.count, 0);
  if (dirtCount < 20) {
    await mineBlock('dirt', 20);
  }

  // 2. Find a suitable flat spot nearby
  const startPos = bot.entity.position.floored();
  const targetPos = startPos.offset(2, 0, 2);
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 1, 10);

  // 3. Build a simple 3x3x3 enclosure
  // Floor/Base is already ground. We build walls.
  const walls = [
  // Wall 1
  {
    x: 0,
    y: 0,
    z: 0
  }, {
    x: 1,
    y: 0,
    z: 0
  }, {
    x: 2,
    y: 0,
    z: 0
  }, {
    x: 0,
    y: 1,
    z: 0
  }, {
    x: 1,
    y: 1,
    z: 0
  }, {
    x: 2,
    y: 1,
    z: 0
  },
  // Wall 2
  {
    x: 0,
    y: 0,
    z: 1
  }, {
    x: 0,
    y: 1,
    z: 1
  }, {
    x: 0,
    y: 0,
    z: 2
  }, {
    x: 0,
    y: 1,
    z: 2
  },
  // Wall 3
  {
    x: 1,
    y: 0,
    z: 2
  }, {
    x: 1,
    y: 1,
    z: 2
  }, {
    x: 2,
    y: 0,
    z: 2
  }, {
    x: 2,
    y: 1,
    z: 2
  },
  // Wall 4 (leaving one block for entrance)
  {
    x: 2,
    y: 0,
    z: 1
  }, {
    x: 2,
    y: 1,
    z: 1
  },
  // Roof
  {
    x: 0,
    y: 2,
    z: 0
  }, {
    x: 1,
    y: 2,
    z: 0
  }, {
    x: 2,
    y: 2,
    z: 0
  }, {
    x: 0,
    y: 2,
    z: 1
  }, {
    x: 1,
    y: 2,
    z: 1
  }, {
    x: 2,
    y: 2,
    z: 1
  }, {
    x: 0,
    y: 2,
    z: 2
  }, {
    x: 1,
    y: 2,
    z: 2
  }, {
    x: 2,
    y: 2,
    z: 2
  }];
  for (const offset of walls) {
    const p = targetPos.plus(offset);
    const existingBlock = bot.blockAt(p);
    if (existingBlock && existingBlock.name === 'air') {
      try {
        await placeItem('dirt', p.x, p.y, p.z);
      } catch (err) {
        // Continue if placement fails for a single block
      }
    }
  }

  // 4. Move inside the shelter
  const inside = targetPos.offset(1, 0, 1);
  await moveTo(inside.x, inside.y, inside.z, 0, 5);
}