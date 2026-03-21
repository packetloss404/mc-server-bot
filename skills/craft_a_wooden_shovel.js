async function craftWoodenShovel(bot) {
  const existingShovel = bot.inventory.items().find(i => i.name === 'wooden_shovel');
  if (existingShovel) return;

  // 1. Ensure inventory space by tossing some seeds
  const seeds = bot.inventory.items().find(i => i.name === 'wheat_seeds');
  if (seeds) {
    await bot.toss(seeds.type, null, seeds.count);
  }

  // 2. Collect 2 logs (enough for table, sticks, and shovel)
  await mineBlock('oak_log', 2);

  // 3. Craft intermediate items
  await craftItem('oak_planks', 2); // 2 logs -> 8 planks
  await craftItem('stick', 1); // 2 planks -> 4 sticks
  await craftItem('crafting_table', 1); // 4 planks -> 1 table

  // 4. Place crafting table if one isn't nearby
  let tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!tableBlock) {
    const referenceBlock = bot.findBlock({
      matching: b => b.name !== 'air' && b.name !== 'water' && b.name !== 'lava' && b.boundingBox === 'block',
      maxDistance: 4
    });
    const pos = referenceBlock ? referenceBlock.position.offset(0, 1, 0) : bot.entity.position.offset(1, 0, 0).floored();
    await placeItem('crafting_table', pos.x, pos.y, pos.z);
    tableBlock = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }

  // 5. Craft the wooden shovel
  // Ingredients: 1 plank, 2 sticks
  await craftItem('wooden_shovel', 1);
}