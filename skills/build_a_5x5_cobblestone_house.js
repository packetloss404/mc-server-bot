async function build5x5CobblestoneHouse(bot) {
  const startPos = bot.entity.position.floored();
  const height = 3;
  const size = 2; // -2 to 2 is 5 blocks
  const doorX = 2;
  const doorZ = 0;

  // Build walls
  for (let y = 0; y < height; y++) {
    for (let x = -size; x <= size; x++) {
      for (let z = -size; z <= size; z++) {
        // Only walls (perimeter)
        if (Math.abs(x) === size || Math.abs(z) === size) {
          // Skip door space
          if (x === doorX && z === doorZ && (y === 0 || y === 1)) {
            continue;
          }
          await placeItem('cobblestone', startPos.x + x, startPos.y + y, startPos.z + z);
        }
      }
    }
  }

  // Build roof
  for (let x = -size; x <= size; x++) {
    for (let z = -size; z <= size; z++) {
      await placeItem('cobblestone', startPos.x + x, startPos.y + height, startPos.z + z);
    }
  }

  // Place door
  await placeItem('oak_door', startPos.x + doorX, startPos.y, startPos.z + doorZ);
}