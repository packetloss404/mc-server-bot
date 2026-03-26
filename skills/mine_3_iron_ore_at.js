async function mineThreeIronOreAtTarget(bot) {
  const targetX = 852;
  const targetY = 52;
  const targetZ = 251;
  const targetName = 'iron_ore';
  const targetCount = 3;

  // Equip stone pickaxe if available
  const stonePickaxe = bot.inventory.items().find(i => i.name === 'stone_pickaxe');
  if (stonePickaxe) {
    await bot.equip(stonePickaxe, 'hand');
  }

  // Move to the target coordinates
  await moveTo(targetX, targetY, targetZ, 2, 60);

  // Check if iron ore is visible at the location
  const ironOre = bot.findBlock({
    matching: b => b.name === targetName || b.name === 'raw_iron' || b.name === 'deepslate_iron_ore',
    maxDistance: 32
  });
  if (!ironOre) {
    // If not immediately found at the exact spot, explore slightly to find the vein
    await exploreUntil('south', 30, () => {
      return bot.findBlock({
        matching: b => b.name === targetName || b.name === 'deepslate_iron_ore',
        maxDistance: 32
      });
    });
  }

  // Mine the required count
  await mineBlock(targetName, targetCount);
}