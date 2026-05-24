async function craft_a_wooden_pickaxe(bot) {
  const inv = bot.inventory.items();
  const hasPickaxe = inv.find(i => i.name === 'wooden_pickaxe');
  if (hasPickaxe) return;

  // Move to nearby crafting table at 962, 4, -63
  await moveTo(962, 4, -63, 2, 10);
  await craftItem('wooden_pickaxe', 1);
}