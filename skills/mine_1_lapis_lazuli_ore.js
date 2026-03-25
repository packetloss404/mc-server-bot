async function mine1LapisLazuliOre(bot) {
  const findLapis = () => bot.findBlock({
    matching: b => ['lapis_ore', 'deepslate_lapis_ore'].includes(b.name),
    maxDistance: 32
  });
  let lapis = findLapis();
  if (!lapis) {
    await exploreUntil(bot, 'south', 60, () => findLapis());
    lapis = findLapis();
  }
  if (lapis) {
    await mineBlock(lapis.name, 1);
  }
}