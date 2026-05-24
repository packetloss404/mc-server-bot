async function explore_west_for_67_blocks(bot) {
  await exploreUntil('west', 25, () => {
    return bot.findBlock({
      matching: b => b.name === 'iron_ingot',
      maxDistance: 32
    }) || bot.findBlock({
      matching: b => b.name === 'raw_iron',
      maxDistance: 32
    });
  });
}