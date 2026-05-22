async function mine_the_new_ironingot_deposit(bot) {
  // First swim to surface if drowning
  await swimToTheSurfaceDrowning(bot);

  // Move to the iron_ore location (known from world memory: 953, 51, 282)
  const targetX = 953;
  const targetY = 51;
  const targetZ = 282;
  await moveTo(targetX, targetY, targetZ, 3, 30);

  // Find the iron_ore block to mine
  const ironOre = bot.findBlock({
    matching: b => b.name === 'iron_ore',
    maxDistance: 5
  });
  if (!ironOre) {
    // Try exploring slightly if not found
    await exploreUntil({
      x: 1,
      y: 0,
      z: 0
    }, 15, () => bot.findBlock({
      matching: b => b.name === 'iron_ore',
      maxDistance: 32
    }));
  }

  // Mine the iron_ore with stone_pickaxe
  const inv = bot.inventory.items();
  const stonePickaxe = inv.find(i => i.name === 'stone_pickaxe');
  if (stonePickaxe) {
    await bot.equip(stonePickaxe, 'hand');
  }
  await mineBlock('iron_ore', 1);
}