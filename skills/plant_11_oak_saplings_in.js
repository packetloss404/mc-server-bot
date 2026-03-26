async function plantOakSaplingGrove(bot) {
  // Check if we have oak saplings in inventory
  let saplings = bot.inventory.items().find(i => i.name === 'oak_sapling');
  let saplingCount = saplings ? saplings.count : 0;

  // If we don't have enough saplings, we need to get them from the chest
  if (saplingCount < 11) {
    // Move to the chest at 858, 65, 254
    await moveTo(858, 65, 254, 3, 10);

    // Withdraw oak saplings from chest
    const needed = 11 - saplingCount;
    await withdrawItem('chest', 'oak_sapling', needed);
  }

  // Find a suitable location near base to plant the grove
  // Start from current position and create a 1x11 line
  const startX = bot.entity.position.x;
  const startZ = bot.entity.position.z;
  const y = Math.floor(bot.entity.position.y);

  // Plant 11 oak saplings in a line (along the z-axis)
  for (let i = 0; i < 11; i++) {
    const plantX = Math.floor(startX);
    const plantZ = Math.floor(startZ + i);

    // Move to the planting position
    await moveTo(plantX, y, plantZ, 1, 5);

    // Place the oak sapling
    await placeItem('oak_sapling', plantX, y, plantZ);
  }
}