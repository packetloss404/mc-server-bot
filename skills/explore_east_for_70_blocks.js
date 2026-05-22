async function explore_east_for_70_blocks(bot) {
  const target = await exploreUntil('east', 30, () => {
    const inv = bot.inventory.items();
    const hasIronIngot = inv.some(i => i.name === 'iron_ingot');
    return hasIronIngot ? {
      found: true
    } : null;
  });
  return target;
}