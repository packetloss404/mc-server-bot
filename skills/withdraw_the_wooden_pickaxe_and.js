async function withdrawItemsFromChest(bot) {
  await walkToSpecificChest(bot);
  await withdrawItem('chest', 'wooden_pickaxe', 1);
  await withdrawItem('chest', 'apple', 1);
}