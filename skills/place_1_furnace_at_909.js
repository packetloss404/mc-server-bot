async function placeFurnaceAtPosition(bot) {
  const furnaceItem = bot.inventory.items().find(i => i.name === 'furnace');
  if (!furnaceItem) {
    const cobblestoneCount = bot.inventory.items().filter(i => i.name === 'cobblestone').reduce((acc, i) => acc + i.count, 0);
    if (cobblestoneCount < 8) {
      await mineBlock('stone', 8 - cobblestoneCount);
    }
    await craftItem('furnace', 1);
  }
  await moveTo(910, 52, 390, 2, 10);
  await placeItem('furnace', 909, 52, 390);
}