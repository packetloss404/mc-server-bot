async function workAtForgeOrShelterUntilDawn(bot) {
  // Dawn has arrived (sunrise) - task is essentially complete
  // But let's do something productive at the nearby furnace
  const furnace = bot.findBlock({
    matching: b => b.name === 'furnace',
    maxDistance: 8
  });
  if (!furnace) { console.log("Block not found"); return; }
  if (furnace) {
    const furnacePos = furnace.position;
    await moveTo(furnacePos.x, furnacePos.y, furnacePos.z, 3, 10);

    // Check inventory for logs to smelt
    const inv = bot.inventory.items();
    const logs = inv.find(i => i.name.includes('log'));
    if (logs) {
      // Smelt logs into charcoal
      await smeltItem('spruce_log', 'coal', 4);
    }
  }

  // Dawn has arrived - task complete
  return;
}