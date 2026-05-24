async function walkToTheNearestShore(bot) {
  const isInWater = () => {
    const feetBlock = bot.blockAt(bot.entity.position);
    return feetBlock && feetBlock.name.includes('water');
  };
  if (!isInWater()) return;
  const landBlocks = ['grass_block', 'dirt', 'sand', 'stone', 'oak_log', 'spruce_log', 'birch_log', 'cobblestone'];
  const land = bot.findBlock({
    matching: b => landBlocks.includes(b.name),
    maxDistance: 32
  });
  if (!land) return;
  const landPos = land.position.offset(0.5, 0, 0.5);
  await bot.lookAt(landPos);
  bot.setControlState('forward', true);
  bot.setControlState('sprint', true);
  await bot.waitForTicks(40);
  bot.clearControlStates();
}