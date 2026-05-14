async function walkTowardsWaterSource(bot) {
  const targetX = 1627;
  const targetY = 62;
  const targetZ = 195;
  const distanceToMove = 20; // The task specifies walking 20 blocks towards the target.

  // Calculate a point 20 blocks closer to the target from the bot's current position.
  const botPos = bot.entity.position;
  // Vec3 is a global object, not part of bot.
  const direction = new Vec3(targetX - botPos.x, targetY - botPos.y, targetZ - botPos.z).normalize();
  const destination = botPos.plus(direction.scale(distanceToMove));

  // Move to the calculated destination.
  await moveTo(destination.x, destination.y, destination.z, 1, 60); // range 1 for precise movement, 60s timeout
}