async function placeCraftingTableAtCurrentPosition(bot) {
  const craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');
  if (craftingTable) {
    const {
      x,
      y,
      z
    } = bot.entity.position;
    // The task specifies placing at the current position, which implies the block *under* the bot.
    // However, placeItem places *on* the specified coordinates, so we need to place on the block below or adjacent.
    // For simplicity and common usage, placing on the block below the bot's feet (y-1) is often desired.
    // The task input is 1632, 71, -2845. If the bot is at 1632, 71, -2845, it should place the table at 1632, 70, -2845.
    // However, `placeItem` takes the coordinates of the *target block*, not the block it's placed *on*.
    // So if the bot is at 1632, 71, -2845, and wants to place *at* that position (where the bot is standing), it needs to place on the block below it.
    // Let's assume the task means placing it on the block *at* y-1 from the given position, if the bot is standing there.
    // Or, if it means placing it *at* the given coordinates (1632, 71, -2845) which is the bot's current exact position,
    // it implies placing it on the block *below* that position, i.e., 1632, 70, -2845.
    // Given the task explicitly states "at your current position (1632, 71, -2845)", it's a bit ambiguous.
    // If the bot is *at* 1632, 71, -2845, it means its feet are at y=71. Placing a block usually means placing it on the block below the feet.
    // Let's use the exact coordinates provided by the task for placement, assuming it's the target block location.
    // This typically means placing it on the block below the bot's current Y level.
    const targetX = 1632;
    const targetY = 71;
    const targetZ = -2845;

    // Check if the target block is air or replaceable.
    // The `placeItem` primitive handles this internally.
    await placeItem('crafting_table', targetX, targetY, targetZ);
  } else {
    // If no crafting table, we need to craft one.
    // This task does not explicitly ask to craft one, but it's a prerequisite.
    // The inventory shows oak_log x1, oak_planks x4.
    // Crafting table requires 4 oak_planks. We have them.
    await craftItem('crafting_table', 1);
    // After crafting, attempt to place again.
    const targetX = 1632;
    const targetY = 71;
    const targetZ = -2845;
    await placeItem('crafting_table', targetX, targetY, targetZ);
  }
}