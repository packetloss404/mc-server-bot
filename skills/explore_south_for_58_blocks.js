async function explore_south_for_58_blocks(bot) {
  // First ensure we're on stable ground and not drowning
  await swimToTheSurfaceDrowning(bot);

  // Move south 58 blocks (negative Z direction)
  const targetZ = bot.entity.position.z - 58;
  await moveTo(bot.entity.position.x, bot.entity.position.y, targetZ, 2, 30);
}