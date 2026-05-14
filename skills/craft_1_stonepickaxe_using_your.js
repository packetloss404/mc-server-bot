async function craftStonePickaxe(bot) {
  // The task is to craft 1 stone_pickaxe.
  // The bot has a crafting_table in its inventory, and enough materials (cobblestone, sticks).
  // The craftItem primitive will handle placing the crafting table if needed and crafting the item.
  await craftItem('stone_pickaxe', 1);
}