async function placeFurnaceAtTarget(bot) {
  let furnace = bot.inventory.items().find(i => i.name === 'furnace');
  if (!furnace) {
    const cobble = bot.inventory.items().find(i => i.name === 'cobblestone');
    if (!cobble || cobble.count < 8) {
      await mineBlock('stone', 8);
    }
    await craftItem('furnace', 1);
  }
  // Place the furnace immediately in front of the bot, on the ground.
  const pos = bot.entity.position;
  const tx = Math.floor(pos.x) + 1;
  const ty = Math.floor(pos.y);
  const tz = Math.floor(pos.z);
  await placeItem('furnace', tx, ty, tz);
}
