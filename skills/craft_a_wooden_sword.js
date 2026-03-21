async function craftWoodenSword(bot) {
  const existingSword = bot.inventory.items().find(i => i.name === 'wooden_sword');
  if (existingSword) return;

  // 1. Ensure inventory space by tossing some seeds
  const seeds = bot.inventory.items().find(i => i.name === 'wheat_seeds');
  if (seeds) {
    await bot.toss(seeds.type, null, seeds.count);
  }

  // 2. Collect 2 logs (1 for table/sticks, 1 for planks/sticks)
  // Actually, 1 log = 4 planks. 
  // 4 planks = 1 crafting table.
  // 1 more log = 4 planks.
  // 2 planks = 4 sticks.
  // 2 planks + 1 stick = 1 wooden sword.
  // Total logs needed: 2.
  await mineBlock('oak_log', 2);

  // 3. Craft ingredients
  await craftItem('oak_planks', 2); // 2 logs -> 8 planks
  await craftItem('crafting_table', 1); // 4 planks used
  await craftItem('stick', 1); // 2 planks used -> 4 sticks

  // Remaining: 2 planks, 4 sticks, 1 crafting table.

  // 4. Place crafting table
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

  // 5. Craft the wooden sword
  await craftItem('wooden_sword', 1);
}