async function mineThreeStoneWithPickaxe(bot) {
  const pickaxe = bot.inventory.items().find(i => i.name === 'wooden_pickaxe');
  if (pickaxe) {
    await bot.equip(pickaxe, 'hand');
  }
  await mineThreeCobblestone(bot);
}