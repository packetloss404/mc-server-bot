async function getToWorkMiningMaterials(bot) {
  const targets = ['coal_ore', 'iron_ore'];
  for (const target of targets) {
    const findTarget = () => bot.findBlock({
      matching: b => b.name === target || b.name === `deepslate_${target}`,
      maxDistance: 32
    });
    let block = findTarget();
    if (!block) {
      await exploreUntil('north', 60, () => findTarget());
    }
    block = findTarget();
    if (block) {
      await mineBlock(block.name, 5);
    }
  }
}