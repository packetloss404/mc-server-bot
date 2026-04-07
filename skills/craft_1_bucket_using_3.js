async function craftBucketAtTable(bot) {
  const ironIngots = bot.inventory.items().find(i => i.name === 'iron_ingot');
  if (!ironIngots || ironIngots.count < 3) {
    await mineBlock('iron_ore', 3);
    await smeltItem('raw_iron', 'coal', 3);
  }
  let tableBlock = bot.findBlock({ matching: b => b.name === 'crafting_table', maxDistance: 32 });
  if (!tableBlock) {
    let table = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!table) {
      await craftItem('crafting_table', 1);
    }
    const pos = bot.entity.position;
    await placeItem('crafting_table', Math.floor(pos.x) + 1, Math.floor(pos.y), Math.floor(pos.z));
    tableBlock = bot.findBlock({ matching: b => b.name === 'crafting_table', maxDistance: 8 });
  }
  if (tableBlock) {
    await moveTo(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 1, 60);
  }
  await craftItem('bucket', 1);
}
