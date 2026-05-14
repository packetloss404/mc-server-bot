async function pickUpCraftingTable(bot) {
  const targetX = 1621;
  const targetY = 81;
  const targetZ = 195;

  // Move to the location of the crafting table
  await moveTo(targetX, targetY, targetZ, 1, 10); // Move within 1 block, 10-second timeout

  // Mine the crafting table
  await mineBlock('crafting_table', 1);
}