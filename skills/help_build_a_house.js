async function helpBuildHouse(bot) {
  const p = bot.entity.position.floored();
  let planks = bot.inventory.items().find(i => i.name === 'oak_planks');
  if (!planks || planks.count < 4) {
    await craftItem('oak_planks', 1);
  }
  await placeItem('oak_planks', p.x + 2, p.y, p.z);
  await placeItem('oak_planks', p.x + 2, p.y + 1, p.z);
  await placeItem('oak_planks', p.x + 3, p.y, p.z);
  await placeItem('oak_planks', p.x + 3, p.y + 1, p.z);
}