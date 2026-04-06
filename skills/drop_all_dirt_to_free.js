async function dropAllDirt(bot) {
  let dirtItem;
  while (dirtItem = bot.inventory.items().find(i => i.name === 'dirt')) {
    await bot.toss(dirtItem.type, null, dirtItem.count);
  }
}