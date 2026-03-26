async function mineOneLapisOre(bot) {
  const lapisTypes = ['lapis_ore', 'deepslate_lapis_ore'];
  let targetName = null;
  const findLapis = () => {
    const block = bot.findBlock({
      matching: b => lapisTypes.includes(b.name),
      maxDistance: 32
    });
    if (block) {
      targetName = block.name;
      return true;
    }
    return false;
  };
  if (!findLapis()) {
    await exploreUntil('south', 60, findLapis);
  }
  if (targetName) {
    await mineBlock(targetName, 1);
  }
}