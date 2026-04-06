async function craftFurnaceAtCraftingTable(bot) {
  const tablePos = {
    x: 947,
    y: 71,
    z: 363
  };
  let cobblestone = bot.inventory.items().find(i => i.name === 'cobblestone');
  const needed = 8;
  if (!cobblestone || cobblestone.count < needed) {
    const toMine = needed - (cobblestone ? cobblestone.count : 0);
    await mineBlock('stone', toMine);
  }
  await moveTo(tablePos.x, tablePos.y, tablePos.z, 1, 30);
  await craftItem('furnace', 1);
}