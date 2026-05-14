async function craftStonePickaxeAtTable(bot) {
  const craftingTablePos = {
    x: 1831,
    y: 80,
    z: -494
  };

  // Move to the crafting table location
  await moveTo(craftingTablePos.x, craftingTablePos.y, craftingTablePos.z, 1, 10);

  // Craft 1 stone_pickaxe
  await craftItem('stone_pickaxe', 1);
}