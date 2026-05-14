async function equipStoneSword(bot) {
  const stoneSword = bot.inventory.items().find(item => item.name === 'stone_sword');
  if (stoneSword) {
    await bot.equip(stoneSword, 'hand');
  } else {
    throw new Error('Stone sword not found in inventory.');
  }
}