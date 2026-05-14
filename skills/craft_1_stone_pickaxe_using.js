async function craft1StonePickaxe(bot) {
  const craftingTablePos = {
    x: 1657,
    y: 70,
    z: 260
  };

  // Move to the crafting table
  await moveTo(craftingTablePos.x, craftingTablePos.y, craftingTablePos.z, 1, 10);

  // Craft the stone pickaxe
  await craftItem('stone_pickaxe', 1);
}