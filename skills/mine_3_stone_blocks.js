async function mineThreeStoneBlocks(bot) {
  const woodenPickaxe = bot.inventory.items().find(i => i.name === 'wooden_pickaxe');
  if (woodenPickaxe) {
    await bot.equip(woodenPickaxe, 'hand');
  }
  await mineThreeCobblestone(bot);
}