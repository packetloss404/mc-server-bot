async function craft_1_furnace_using_8(bot) {
  const craftingTablePos = {
    x: 1657,
    y: 70,
    z: 260
  };

  // Move to the crafting table
  await moveTo(craftingTablePos.x, craftingTablePos.y, craftingTablePos.z, 1, 10);

  // Craft the furnace
  await craftItem('furnace', 1);
}