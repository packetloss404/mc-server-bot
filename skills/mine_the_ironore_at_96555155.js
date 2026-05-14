async function mineIronOreAt96555155(bot) {
  const targetX = 965;
  const targetY = 55;
  const targetZ = 155;
  const targetBlockName = 'iron_ore';
  const toolName = 'iron_pickaxe';

  // Check if the bot has an iron pickaxe
  let pickaxe = bot.inventory.items().find(item => item.name === toolName);
  if (!pickaxe) {
    // Attempt to craft one if not found (assuming crafting recipe for iron pickaxe exists and bot has materials)
    // This is a placeholder, as the task doesn't explicitly ask to craft.
    // In a real scenario, this would involve checking for iron ingots and sticks.
    // For now, assume a pickaxe is needed, and if not present, the task might fail.
    // The current task guidance doesn't include crafting, so we proceed assuming it will be available.
    // If this fails, it implies a missing prerequisite.
    // For this specific task, we will just proceed and let mineBlock handle the tool requirement.
  }

  // Move to the vicinity of the target block
  // Using a range of 1 to be right next to it for mining
  await moveTo(targetX, targetY, targetZ, 1, 60);

  // Mine the block
  await mineBlock(targetBlockName, 1);
}