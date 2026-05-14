async function mineIronOreAtSpecificLocation(bot) {
  const targetX = 860;
  const targetY = 61;
  const targetZ = 284;
  const targetBlockName = 'iron_ore';

  // Ensure the bot has a stone pickaxe
  const stonePickaxe = bot.inventory.items().find(item => item.name === 'stone_pickaxe');
  if (!stonePickaxe) {
    // This task assumes the bot already has a stone pickaxe.
    // If not, it would need to craft or find one, which is outside the scope of this specific task.
    throw new Error('Stone pickaxe not found in inventory.');
  }

  // Equip the stone pickaxe
  await bot.equip(stonePickaxe, 'hand');

  // Move to the target location
  // The range for mining is usually 4-5 blocks, so moving close is essential.
  // The '2' range allows for slight positioning adjustments.
  await moveTo(targetX, targetY, targetZ, 2, 60); // 60 seconds timeout for movement

  // After moving, verify the block is there and mine it.
  // mineBlock can take coordinates directly if the block name is known.
  await mineBlock(targetBlockName, 1, targetX, targetY, targetZ);
}