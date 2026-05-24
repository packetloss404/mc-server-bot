async function mineOrShelter(bot) {
  // Check if bot is drowning (null-safe)
  const eyePos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
  const eyeBlock = bot.blockAt(eyePos);
  const feetBlock = bot.blockAt(bot.entity.position);
  const isInWater = eyeBlock && eyeBlock.name.includes('water') || feetBlock && feetBlock.name.includes('water');
  if (isInWater) {
    await swimToTheSurfaceDrowning(bot);
    return;
  }

  // Check for urgent shelter needs (rain/night) - use null-safe access
  const time = bot.time?.timeOfDay;
  const isNight = time !== undefined && (time < 13000 || time > 23000);
  const dimension = bot.game?.dimension;
  if (isNight || dimension === 'nether') {
    await seek_shelter_urgently_rainy_night(bot);
    return;
  }

  // It's daytime and not drowning - continue mining underground
  // Target ore locations from world memory: iron_ore@1047,53,41 and coal_ore@1046,59,42
  // Current position: Y=73, ore at Y=53-59 (need to go down ~15-20 blocks)

  const oreTarget = {
    x: 1047,
    y: 55,
    z: 41
  }; // Target iron ore area
  await moveTo(oreTarget.x, oreTarget.y, oreTarget.z, 2, 30);

  // Mine ore blocks in the area
  const oreBlock = bot.findBlock({
    matching: b => b.name === 'iron_ore' || b.name === 'coal_ore',
    maxDistance: 5
  });
  if (!oreBlock) { console.log("Block not found"); return; }
  if (oreBlock) {
    await mineBlock(oreBlock.name, 1);
  }
}