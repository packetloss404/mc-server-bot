async function buildCobblestonePerimeterWall(bot) {
  const centerPos = {
    x: 857,
    y: 65,
    z: 254
  };

  // Check cobblestone inventory
  let cobbleItem = bot.inventory.items().find(i => i.name === 'cobblestone');
  let cobbleCount = cobbleItem ? cobbleItem.count : 0;

  // We need a perimeter wall around the workstation
  // A 5x5 perimeter is approximately 16 blocks per layer × 3 layers = 48 blocks minimum
  if (cobbleCount < 48) {
    await mineBlock('cobblestone', 48 - cobbleCount);
  }

  // Build perimeter walls around the workstation at (857, 65, 254)
  // Create a 5x5 perimeter (2 blocks out in each direction from center)
  const positions = [];

  // North and South walls (x direction)
  for (let x = centerPos.x - 2; x <= centerPos.x + 2; x++) {
    // North wall (z - 2)
    positions.push({
      x,
      y: centerPos.y,
      z: centerPos.z - 2
    });
    positions.push({
      x,
      y: centerPos.y + 1,
      z: centerPos.z - 2
    });
    positions.push({
      x,
      y: centerPos.y + 2,
      z: centerPos.z - 2
    });

    // South wall (z + 2)
    positions.push({
      x,
      y: centerPos.y,
      z: centerPos.z + 2
    });
    positions.push({
      x,
      y: centerPos.y + 1,
      z: centerPos.z + 2
    });
    positions.push({
      x,
      y: centerPos.y + 2,
      z: centerPos.z + 2
    });
  }

  // East and West walls (z direction, excluding corners already done)
  for (let z = centerPos.z - 1; z <= centerPos.z + 1; z++) {
    // West wall (x - 2)
    positions.push({
      x: centerPos.x - 2,
      y: centerPos.y,
      z
    });
    positions.push({
      x: centerPos.x - 2,
      y: centerPos.y + 1,
      z
    });
    positions.push({
      x: centerPos.x - 2,
      y: centerPos.y + 2,
      z
    });

    // East wall (x + 2)
    positions.push({
      x: centerPos.x + 2,
      y: centerPos.y,
      z
    });
    positions.push({
      x: centerPos.x + 2,
      y: centerPos.y + 1,
      z
    });
    positions.push({
      x: centerPos.x + 2,
      y: centerPos.y + 2,
      z
    });
  }

  // Place cobblestone blocks
  for (const pos of positions) {
    await placeItem('cobblestone', pos.x, pos.y, pos.z);
  }
}