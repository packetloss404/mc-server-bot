async function craft_a_wooden_pickaxe(bot) {
  const inv = bot.inventory.items();
  const hasPickaxe = inv.find(i => i.name === 'wooden_pickaxe');
  if (hasPickaxe) return;

  // Move to crafting table
  await moveTo(952, 57, 344, 2, 10);
  await craftItem('wooden_pickaxe', 1);
}