async function mineBoneBlock(bot) {
  const targetBlock = 'bone_block';
  const count = 1;
  let boneBlock = bot.findBlock({
    matching: b => b.name === targetBlock,
    maxDistance: 32
  });
  if (!boneBlock) {
    boneBlock = await exploreUntil('north', 120, () => {
      return bot.findBlock({
        matching: b => b.name === targetBlock,
        maxDistance: 32
      });
    });
  }
  if (boneBlock) {
    await mineBlock(targetBlock, count);
  }
}