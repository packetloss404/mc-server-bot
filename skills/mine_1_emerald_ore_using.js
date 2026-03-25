async function mineEmeraldWithIronPickaxe(bot) {
  let ironPick = bot.inventory.items().find(i => i.name === 'iron_pickaxe');
  if (!ironPick) {
    let ingots = bot.inventory.items().find(i => i.name === 'iron_ingot');
    let ingotCount = ingots ? ingots.count : 0;
    if (ingotCount < 3) {
      let rawIronItem = bot.inventory.items().find(i => i.name === 'raw_iron');
      let rawCount = rawIronItem ? rawIronItem.count : 0;
      if (rawCount < 3 - ingotCount) {
        let ironBlock = bot.findBlock({
          matching: b => ['iron_ore', 'deepslate_iron_ore'].includes(b.name),
          maxDistance: 32
        });
        if (!ironBlock) {
          ironBlock = await exploreUntil('south', 60, () => bot.findBlock({
            matching: b => ['iron_ore', 'deepslate_iron_ore'].includes(b.name),
            maxDistance: 32
          }));
        }
        if (ironBlock) {
          await mineBlock(ironBlock.name, 3 - ingotCount - rawCount);
        }
      }
      rawIronItem = bot.inventory.items().find(i => i.name === 'raw_iron');
      if (rawIronItem) {
        await smeltItem('raw_iron', 'coal', 3 - ingotCount);
      }
    }
    await craftItem('iron_pickaxe', 1);
  }
  let emeraldBlock = bot.findBlock({
    matching: b => ['emerald_ore', 'deepslate_emerald_ore'].includes(b.name),
    maxDistance: 32
  });
  if (!emeraldBlock) {
    emeraldBlock = await exploreUntil('north', 120, () => bot.findBlock({
      matching: b => ['emerald_ore', 'deepslate_emerald_ore'].includes(b.name),
      maxDistance: 32
    }));
  }
  if (emeraldBlock) {
    await mineBlock(emeraldBlock.name, 1);
  }
}