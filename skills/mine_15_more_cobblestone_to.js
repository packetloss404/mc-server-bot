async function mine15MoreCobblestone(bot) {
  let cobblestoneCount = bot.inventory.items().find(i => i.name === 'cobblestone')?.count || 0;
  const targetCount = 15;
  const needed = targetCount - cobblestoneCount;
  if (needed <= 0) {
    return; // Already have enough cobblestone
  }

  // Check for a pickaxe in inventory
  let pickaxe = bot.inventory.items().find(item => item.name.includes('pickaxe'));
  if (!pickaxe) {
    // If no pickaxe, assume the bot needs to craft one or is stuck.
    // For this task, we assume a pickaxe is available or the task will fail later if not.
    // This is a common pattern: check for tools, but for mining, `mineBlock` usually handles tool selection.
  }

  // Explore until cobblestone is found
  await exploreUntil('north',
  // Start exploring north, then it will fan out
  600,
  // Explore for up to 60 seconds
  () => {
    const block = bot.findBlock({
      matching: b => b.name === 'stone',
      maxDistance: 32
    });
    if (!block) { console.log("Block not found"); return; }
    return block ? block.position : null;
  });

  // Mine the needed cobblestone
  await mineBlock('stone', needed);
}