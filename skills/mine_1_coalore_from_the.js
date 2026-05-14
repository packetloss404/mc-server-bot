async function mine1CoalOreFromTheNearestKnownDeposit(bot) {
  const targetBlockName = 'coal_ore';
  const targetX = 806;
  const targetY = 52;
  const targetZ = 192;

  // Move to the target location. A small range is sufficient for mining.
  await moveTo(targetX, targetY, targetZ, 4, 60); // 4 block range, 60 seconds timeout

  // Equip a pickaxe if not already equipped. Stone pickaxe is in inventory.
  const pickaxe = bot.inventory.items().find(item => item.name.includes('pickaxe'));
  if (pickaxe) {
    await bot.equip(pickaxe, 'hand');
  } else {
    // If no pickaxe, the bot cannot mine, so it should fail.
    throw new Error('No pickaxe found in inventory to mine coal_ore.');
  }

  // Find the coal_ore block at the specified location or nearby.
  // We need to find the exact block to mine, not just explore for it.
  const coalOreBlock = bot.findBlock({
    matching: block => block.name === targetBlockName,
    maxDistance: 32 // Search within 32 blocks
  });
  if (!coalOreBlock) {
    throw new Error(`Could not find ${targetBlockName} at or near ${targetX},${targetY},${targetZ}`);
  }

  // Mine the block. The mineBlock primitive will handle moving closer if needed.
  await mineBlock(targetBlockName, 1);
}