async function mine3CoalOreAtLocation(bot) {
  let pickaxe = bot.inventory.items().find(i => i.name.includes('pickaxe'));
  if (pickaxe) {
    await bot.equip(pickaxe, 'hand');
  }
  await moveTo(947, 48, 367, 3);
  await mineBlock('coal_ore', 3);
}