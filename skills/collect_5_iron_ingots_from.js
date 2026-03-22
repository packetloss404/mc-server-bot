async function collectIronIngotsFromChest(bot) {
  const chestX = 858;
  const chestY = 65;
  const chestZ = 254;
  await moveTo(chestX, chestY, chestZ, 2, 60);
  await withdrawItem('chest', 'iron_ingot', 5);
}