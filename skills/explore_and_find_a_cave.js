async function findCaveEntrance(bot) {
  const north = {
    x: 0,
    y: 0,
    z: -1
  };
  const caveEntrance = await exploreUntil(north, 120, () => {
    return bot.findBlock({
      matching: block => block.name === 'cave_air',
      maxDistance: 32
    });
  });
  if (caveEntrance) {
    await moveTo(caveEntrance.position.x, caveEntrance.position.y, caveEntrance.position.z, 2);
  }
}