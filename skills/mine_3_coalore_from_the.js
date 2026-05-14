async function mineThreeCoalOre(bot) {
  const targetX = 1637;
  const targetY = 85;
  const targetZ = 166;
  const count = 3;
  const blockName = 'coal_ore';

  // Ensure the bot has a stone_pickaxe
  const pickaxe = bot.inventory.items().find(item => item.name === 'stone_pickaxe');
  if (!pickaxe) {
    // This task assumes a pickaxe is available. If not, we cannot complete it.
    // In a real scenario, we would craft one or find one.
    throw new Error('No stone_pickaxe found in inventory to mine coal_ore.');
  }

  // Move to the target location. Adding a small range for flexibility.
  await moveTo(targetX, targetY, targetZ, 1, 60);

  // Equip the stone_pickaxe
  await bot.equip(pickaxe, 'hand');

  // Mine the coal_ore
  await mineBlock(blockName, count);
}