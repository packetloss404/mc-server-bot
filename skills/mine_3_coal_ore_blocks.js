async function mine3CoalOreBlocks(bot) {
  const pickaxe = bot.inventory.items().find(i => i.name.includes('pickaxe'));
  if (pickaxe) {
    await bot.equip(pickaxe, 'hand');
  }
  const coal = bot.findBlock({
    matching: b => b.name === 'coal_ore',
    maxDistance: 32
  });
  if (!coal) {
    await exploreUntil('north', 60, () => bot.findBlock({
      matching: b => b.name === 'coal_ore',
      maxDistance: 32
    }));
  }
  await mineBlock('coal_ore', 3);
}