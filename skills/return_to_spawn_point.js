async function returnToSpawnPoint(bot) {
  // Assuming the spawn point is approximately at X=0, Z=0.
  // In Minecraft, the initial spawn area is often around 0,0,
  // or the world spawn is set to a specific location.
  // Without specific coordinates, moving towards 0,0 is a reasonable approximation.
  // We'll use a y-coordinate that's likely safe (e.g., 64, common ground level).
  // The range can be generous, as the exact spawn point might vary slightly.
  const spawnX = 0;
  const spawnY = 64; // A common Y level for ground, adjust if specific spawn Y is known
  const spawnZ = 0;
  const range = 16; // Allow a 16-block radius as "at spawn"

  await moveTo(spawnX, spawnY, spawnZ, range, 120); // 120 seconds timeout for long travel
}