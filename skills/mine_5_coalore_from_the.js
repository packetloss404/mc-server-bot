async function mine5CoalOreFromNearestVein(bot) {
  const targetX = 857;
  const targetY = 61;
  const targetZ = 284;
  const countToMine = 5;

  // Equip iron pickaxe
  const ironPickaxe = bot.inventory.items().find(item => item.name === 'iron_pickaxe');
  if (!ironPickaxe) {
    throw new Error("Cannot mine coal_ore: iron_pickaxe not found in inventory.");
  }
  await bot.equip(ironPickaxe, 'hand');

  // First, try to find coal ore near the specified target coordinate.
  // We cannot use 'point' directly with bot.findBlock as bot.Vec3 is not available in this scope.
  // Instead, we will move to the target coordinates first, then search for the block.
  await moveTo(targetX, targetY, targetZ, 4, 30); // Move to the general area

  let minedCount = 0;
  while (minedCount < countToMine) {
    const coalOreBlock = bot.findBlock({
      matching: b => b.name === 'coal_ore',
      maxDistance: 32
    });
    if (!coalOreBlock) {
      throw new Error("No more coal_ore found within 32 blocks after moving to target area.");
    }
    await mineBlock(coalOreBlock.name, 1);
    minedCount++;
  }
}