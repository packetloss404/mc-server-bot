async function mineOneEmeraldOre(bot) {
  const emeraldFilter = b => b.name === 'emerald_ore' || b.name === 'deepslate_emerald_ore';
  let emeraldBlock = bot.findBlock({
    matching: emeraldFilter,
    maxDistance: 32
  });
  if (!emeraldBlock) {
    await exploreUntil('north', 120, () => {
      return bot.findBlock({
        matching: emeraldFilter,
        maxDistance: 32
      });
    });
    emeraldBlock = bot.findBlock({
      matching: emeraldFilter,
      maxDistance: 32
    });
  }
  if (emeraldBlock) {
    const pickaxe = bot.inventory.items().find(i => i.name.endsWith('_pickaxe'));
    if (pickaxe) {
      await bot.equip(pickaxe, 'hand');
    }
    await mineBlock(emeraldBlock.name, 1);
  }
}