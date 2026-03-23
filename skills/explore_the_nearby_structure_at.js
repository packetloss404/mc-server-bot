async function exploreStructureAt847(bot) {
  const centerX = 847;
  const centerY = 70;
  const centerZ = 200;

  // Move to the initial structure center
  await moveTo(centerX, centerY, centerZ, 2, 20);

  // Define exploration points around the structure
  const offsets = [{
    x: 8,
    z: 8
  }, {
    x: -8,
    z: -8
  }, {
    x: 8,
    z: -8
  }, {
    x: -8,
    z: 8
  }];
  for (const offset of offsets) {
    const targetX = centerX + offset.x;
    const targetZ = centerZ + offset.z;

    // Move to exploration point
    await moveTo(targetX, centerY, targetZ, 3, 20);

    // Look for containers to inspect
    const container = bot.findBlock({
      matching: block => ['chest', 'barrel', 'shulker_box', 'dispenser', 'dropper'].includes(block.name),
      maxDistance: 16
    });
    if (container) {
      await moveTo(container.position.x, container.position.y, container.position.z, 2, 15);
      await inspectContainer(container.name);
    }
  }

  // Pick up items that might be lying around the structure
  await pickUpTenNearbyItems(bot);

  // Return to center
  await moveTo(centerX, centerY, centerZ, 2, 20);
}