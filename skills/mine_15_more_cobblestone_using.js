async function mine15MoreCobblestoneUsingStonePickaxe(bot) {
  const pickaxe = bot.inventory.items().find(item => item.name === 'stone_pickaxe');
  if (!pickaxe) {
    throw new Error('Stone pickaxe not found in inventory.');
  }
  await bot.equip(pickaxe, 'hand');
  const targetCount = 15;
  let currentCobblestone = bot.inventory.items().find(item => item.name === 'cobblestone')?.count || 0;
  const neededCobblestone = targetCount - currentCobblestone % targetCount; // Calculate how much more is needed to reach a multiple of 15, or just 15 if current is 0.
  // The task asks for "15 more", so we just need to mine 15, regardless of current count.

  await mineBlock('cobblestone', 15);
}