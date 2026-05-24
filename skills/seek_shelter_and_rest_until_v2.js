async function seekShelterAndRestUntilDawn(bot) {
  // Check if underwater and swim to surface first
  const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
  const eyeBlock = bot.blockAt(eyePos);
  if (eyeBlock && eyeBlock.name.includes('water')) {
    const feet = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (feet && feet.name !== 'water' && feet.name !== 'lava') {
      await moveTo(bot.entity.position.x + 4, bot.entity.position.y, bot.entity.position.z, 2, 5);
    } else {
      await bot.look(bot.entity.yaw, -Math.PI / 2);
      bot.setControlState('jump', true);
      bot.setControlState('forward', true);
      await bot.waitForTicks(40);
      bot.clearControlStates();
    }
  }

  // Check inventory for dirt/cobblestone
  const inv = bot.inventory.items();
  const dirtCount = inv.find(i => i.name === 'dirt')?.count || 0;
  const cobbleCount = inv.find(i => i.name === 'cobblestone')?.count || 0;
  const blockCount = dirtCount + cobbleCount;

  // Gather dirt if needed
  if (blockCount < 15) {
    const needed = 15 - blockCount;
    await mineBlock('dirt', needed);
  }

  // Get current position for building
  const pos = bot.entity.position;
  const x = Math.floor(pos.x);
  const y = Math.floor(pos.y);
  const z = Math.floor(pos.z);

  // Determine block type to use
  const currentInv = bot.inventory.items();
  const blockType = currentInv.find(i => i.name === 'dirt') ? 'dirt' : 'cobblestone';

  // Build a small 3x3 shelter - walls on 3 sides (leave south side open as door)
  // First place floor blocks at eye level and below
  await placeItem(blockType, x - 1, y - 1, z);
  await placeItem(blockType, x + 1, y - 1, z);
  await placeItem(blockType, x - 1, y, z);
  await placeItem(blockType, x + 1, y, z);

  // North wall (z - 1)
  await placeItem(blockType, x - 1, y, z - 1);
  await placeItem(blockType, x, y, z - 1);
  await placeItem(blockType, x + 1, y, z - 1);

  // East wall (x + 1)
  await placeItem(blockType, x + 1, y, z - 1);
  await placeItem(blockType, x + 1, y, z + 1);

  // West wall (x - 1)
  await placeItem(blockType, x - 1, y, z - 1);
  await placeItem(blockType, x - 1, y, z + 1);

  // Ceiling (y + 2)
  await placeItem(blockType, x - 1, y + 2, z - 1);
  await placeItem(blockType, x + 1, y + 2, z - 1);
  await placeItem(blockType, x - 1, y + 2, z + 1);
  await placeItem(blockType, x + 1, y + 2, z + 1);

  // Rest until dawn using bed if available
  const bed = bot.inventory.items().find(i => i.name.includes('bed'));
  if (bed) {
    await bot.equip(bed, 'hand');
    const bedPos = bot.findBlock({
      matching: b => b.name.includes('bed'),
      maxDistance: 16
    });
    if (bedPos) {
      await moveTo(bedPos.x, bedPos.y, bedPos.z, 1, 5);
      await bot.sleep();
    }
  } else {
    // Just wait until day by checking time
    await bot.waitForTicks(200);
  }
}