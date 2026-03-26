async function placeThreeOakDoors(bot) {
  // Check inventory for oak doors
  let doorItem = bot.inventory.items().find(i => i.name === 'oak_door');
  let doorCount = doorItem ? doorItem.count : 0;

  // If we don't have 3 oak doors, we need to craft them
  if (doorCount < 3) {
    const needed = 3 - doorCount;
    // Craft oak doors (each door requires 6 oak planks)
    await craftItem('oak_door', needed);
  }

  // Place 3 oak doors at different locations around the current position
  const pos = bot.entity.position;

  // Place first door to the right
  await placeItem('oak_door', pos.x + 1, pos.y, pos.z);

  // Place second door ahead
  await placeItem('oak_door', pos.x, pos.y, pos.z + 1);

  // Place third door to the left
  await placeItem('oak_door', pos.x - 1, pos.y, pos.z);
}