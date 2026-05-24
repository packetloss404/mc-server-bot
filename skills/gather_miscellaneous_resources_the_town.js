async function gatherMiscellaneousResourcesTheTown(bot) {
  // Town needs ores and stone - bot has plenty of wood but nothing mined
  const targetBlocks = ['iron_ore', 'coal_ore', 'stone'];
  for (const blockName of targetBlocks) {
    const block = bot.findBlock({
      matching: b => b.name === blockName,
      maxDistance: 32
    });
    if (!block) { console.log("Block not found"); return; }
    if (block) {
      await mineBlock(blockName, 8);
    } else {
      // Search for the resource if not nearby
      const found = await exploreUntil('any', 30, () => bot.findBlock({
        matching: b => b.name === blockName,
        maxDistance: 32
      }));
      if (found) {
        await mineBlock(blockName, 8);
      }
    }
  }
}