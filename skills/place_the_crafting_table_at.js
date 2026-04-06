async function placeTableAndCraftDoor(bot) {
  const targetX = 952;
  const targetY = 56;
  const targetZ = 344;

  // 1. Ensure we have a crafting table in inventory
  let table = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (!table) {
    await mineBlock('oak_log', 1);
    await craftItem('oak_planks', 1);
    await craftItem('crafting_table', 1);
  }

  // 2. Move to the target position and place the crafting table
  await moveTo(targetX, targetY, targetZ, 3);
  await placeItem('crafting_table', targetX, targetY, targetZ);

  // 3. Check if we need materials for doors (6 planks for 3 doors)
  // The user already has 3 oak_doors, but the task specifies crafting a bed or door.
  // Let's ensure we have enough planks to craft more doors if needed.
  let planks = bot.inventory.items().find(i => i.name === 'oak_planks');
  if (!planks || planks.count < 6) {
    await mineBlock('oak_log', 2);
    await craftItem('oak_planks', 2);
  }

  // 4. Craft the doors at the placed crafting table
  await craftItem('oak_door', 1);
}