async function explore_west_for_60_blocks(bot) {
  await explore_west_for_54_blocks(bot);
  await exploreUntil('west', 6, () => {
    return bot.findBlock({
      matching: block => block.name === 'iron_ore',
      maxDistance: 32
    }) || bot.findBlock({
      matching: block => block.name === 'deepslate_iron_ore',
      maxDistance: 32
    });
  });
}