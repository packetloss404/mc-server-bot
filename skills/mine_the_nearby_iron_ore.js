async function mineTheNearbyIronOre(bot) {
  const ironOrePos = {
    x: 941,
    y: 60,
    z: 356
  };
  await moveTo(ironOrePos.x, ironOrePos.y, ironOrePos.z, 2, 30);
  await mineBlock('iron_ore', 1);
}