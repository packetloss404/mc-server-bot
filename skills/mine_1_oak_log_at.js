async function mineOneOakLog(bot) {
  const targetName = 'oak_log';
  const targetCount = 1;
  const getCount = () => {
    const item = bot.inventory.items().find(i => i.name === targetName);
    return item ? item.count : 0;
  };
  const initialCount = getCount();

  // Find the block
  let log = bot.findBlock({
    matching: b => b.name === targetName,
    maxDistance: 32
  });

  // If not found, explore or move towards the known location
  if (!log) {
    // The task mentions 847, 71, 1 (likely 847, 71, 199 based on memory)
    // We'll move towards the memory location if available
    await moveTo(847, 71, 199, 5, 40);
    log = bot.findBlock({
      matching: b => b.name === targetName,
      maxDistance: 32
    });
  }

  // If still not found, explore
  if (!log) {
    await exploreUntil('north', 60, () => bot.findBlock({
      matching: b => b.name === targetName,
      maxDistance: 32
    }));
  }

  // Mine the block
  await mineBlock(targetName, targetCount);

  // Confirm count
  const currentCount = getCount();
  if (currentCount <= initialCount) {
    // Try one more time if the count didn't increase
    await mineBlock(targetName, 1);
  }
}