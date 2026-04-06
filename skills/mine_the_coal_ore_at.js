async function mineCoalOreAtTarget(bot) {
  const targetPos = {
    x: 957,
    y: 68,
    z: 364
  };
  const pickaxe = bot.inventory.items().find(i => i.name.includes('pickaxe'));
  if (pickaxe) {
    await bot.equip(pickaxe, 'hand');
  }
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 4, 30);
  await mineBlock('coal_ore', 1);
}