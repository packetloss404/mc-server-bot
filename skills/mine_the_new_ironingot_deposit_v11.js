async function mine_the_new_ironingot_deposit(bot) {
  // First check if iron ore is already nearby
  const nearbyIronOre = bot.findBlock({
    matching: b => b.name === 'iron_ore',
    maxDistance: 32
  });
  if (!nearbyIronOre) { console.log("Block not found"); return; }
  if (nearbyIronOre) {
    await mineBlock('iron_ore', 1);
    return;
  }

  // Iron ore not nearby, explore outward using world memory direction
  // From position 842, 28, 238, iron_ore at 872,39,193 is to the east
  const targetBlock = await exploreUntil(bot, {
    x: 1,
    y: 0,
    z: 0
  }, 15, () => {
    return bot.findBlock({
      matching: b => b.name === 'iron_ore',
      maxDistance: 32
    });
  });
  if (targetBlock) {
    await mineBlock('iron_ore', 1);
  }
}