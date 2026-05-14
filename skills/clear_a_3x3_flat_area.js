async function clearA3x3FlatArea(bot) {
  const currentPos = bot.entity.position.floored();
  const radius = 1; // For a 3x3 area, the radius from the center is 1 block in each direction

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const targetX = currentPos.x + dx;
      const targetY = currentPos.y - 1; // Clear blocks at the level below the bot's feet
      const targetZ = currentPos.z + dz;
      // The Vec3 constructor is usually available directly in the environment, not through bot.Vec3
      // Assuming Vec3 is available globally or implicitly in scope for this environment.
      // If not, it might be bot.currentBlock.position.constructor (less likely) or a global Vec3.
      // For this environment, let's assume `Vec3` is directly available or that bot.blockAt accepts plain objects.
      // A common pattern is to just pass numbers if Vec3 is not directly accessible.
      // However, the most robust way is to ensure Vec3 is in scope.
      // Given the previous error, let's try to assume Vec3 is a global constructor.
      // If Vec3 is not globally available, a block object can be used if bot.blockAt accepts it, or pass raw coordinates.
      // The `mineflayer` library usually makes `Vec3` available directly.
      const targetBlockPos = new Vec3(targetX, targetY, targetZ);
      const block = bot.blockAt(targetBlockPos);
      if (block && (block.name === 'dirt' || block.name === 'grass_block')) {
        await mineBlock(block.name, 1);
      }
    }
  }
}