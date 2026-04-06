async function placeStonecutterAt1029(bot) {
  const stonecutterItem = bot.inventory.items().find(i => i.name === 'stonecutter');
  if (!stonecutterItem) {
    await moveTo(1028, 65, 409, 2);
    await withdrawItem('chest', 'stonecutter', 1);
  }
  await moveTo(1029, 65, 409, 3);
  await placeItem('stonecutter', 1029, 65, 409);
}