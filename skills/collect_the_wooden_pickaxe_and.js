async function collectItemsFromChest(bot) {
  const chestPos = {
    x: 855,
    y: 64,
    z: 259
  };
  await moveTo(chestPos.x, chestPos.y, chestPos.z, 2, 60);
  await withdrawItem('chest', 'wooden_pickaxe', 1);
  await withdrawItem('chest', 'oak_door', 2);
}