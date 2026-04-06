async function retrieveStonecutterFromChest(bot) {
  const chestPos = {
    x: 1028,
    y: 65,
    z: 409
  };
  await moveTo(chestPos.x, chestPos.y, chestPos.z, 2, 60);
  await withdrawItem('chest', 'stonecutter', 1);
}