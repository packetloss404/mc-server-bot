async function buildCobblestoneWall(bot) {
  const workstationPos = {
    x: 857,
    y: 65,
    z: 254
  };

  // Check current cobblestone inventory
  let cobbleItem = bot.inventory.items().find(i => i.name === 'cobblestone');
  let cobbleCount = cobbleItem ? cobbleItem.count : 0;

  // We have 21 cobblestone blocks to build a perimeter wall
  // Build a 3-block tall wall around the workstation (perimeter)
  // Workstation at (857, 65, 254) - we'll build around it

  const baseY = 64; // Ground level
  const height = 3; // 3 blocks tall

  // Define perimeter positions (1 block away from workstation, forming a square)
  // Workstation is at 857, 65, 254
  // Build a 5x5 perimeter around it (from 856-858, 254-256 in XZ)
  const perimeterPositions = [
  // North side (z = 253)
  {
    x: 856,
    z: 253
  }, {
    x: 857,
    z: 253
  }, {
    x: 858,
    z: 253
  },
  // South side (z = 255)
  {
    x: 856,
    z: 255
  }, {
    x: 857,
    z: 255
  }, {
    x: 858,
    z: 255
  },
  // East side (x = 859, excluding corners already placed)
  {
    x: 859,
    z: 254
  },
  // West side (x = 855, excluding corners already placed)
  {
    x: 855,
    z: 254
  }];
  let blocksPlaced = 0;

  // Place cobblestone blocks at each position for 3 blocks tall
  for (const pos of perimeterPositions) {
    for (let y = 0; y < height; y++) {
      if (blocksPlaced < cobbleCount) {
        await placeItem('cobblestone', pos.x, baseY + y, pos.z);
        blocksPlaced++;
      }
    }
  }
}