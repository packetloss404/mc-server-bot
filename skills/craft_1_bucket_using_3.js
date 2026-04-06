async function craftBucketAtTable(bot) {
  const tablePos = {
    x: 947,
    y: 71,
    z: 363
  };
  const ironIngots = bot.inventory.items().find(i => i.name === 'iron_ingot');
  if (!ironIngots || ironIngots.count < 3) {
    await mineBlock('iron_ore', 3);
    await smeltItem('raw_iron', 'coal', 3);
  }
  await moveTo(tablePos.x, tablePos.y, tablePos.z, 1, 60);
  await craftItem('bucket', 1);
}