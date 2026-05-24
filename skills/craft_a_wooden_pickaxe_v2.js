async function craft_a_wooden_pickaxe(bot) {
  const inv = bot.inventory.items();
  const hasPickaxe = inv.find(i => i.name === 'wooden_pickaxe');
  if (hasPickaxe) return;
  await craftItem('wooden_pickaxe', 1);
}