async function mineIronOreAtSpecificLocation(bot) {
  const targetX = 852;
  const targetY = 59;
  const targetZ = 279;
  const targetBlockName = 'iron_ore';
  const toolName = 'stone_pickaxe';

  // Check if we have a stone pickaxe, if not, try to craft one (assuming craftStonePickaxe is a known skill)
  let pickaxe = bot.inventory.items().find(item => item.name === toolName);
  if (!pickaxe) {
    // This task specifically says "using your stone_pickaxe", implying it should exist.
    // If it doesn't, the bot cannot complete the task as specified.
    // For now, we'll assume the pickaxe is available or the task implies it should be crafted if needed,
    // but without a specific "craftStonePickaxe" skill provided, we can only check inventory.
    // If it's truly missing and no crafting skill is available, the bot cannot proceed.
    // For this specific task, we'll just check and fail if not found.
    throw new Error(`Cannot mine ${targetBlockName}: ${toolName} not found in inventory.`);
  }

  // Move to the target location. The range can be 4 to be adjacent to the block.
  await moveTo(targetX, targetY, targetZ, 4, 60);

  // Now that we are near the block, equip the pickaxe and mine it.
  // mineBlock automatically equips the best tool, but explicitly equipping is safer if the task specifies a tool.
  await mineBlock(targetBlockName, 1);
}