async function patrolSquare(bot) {
  const startX = bot.entity.position.x;
  const startY = bot.entity.position.y;
  const startZ = bot.entity.position.z;
  const size = 20;
  const halfSize = size / 2;
  const range = 2; // Tolerance for moveTo

  // Define the four corners of the square relative to the current position
  // (Assuming the current position is the center of the square for simplicity,
  // or one corner, let's go with starting at current and moving in a square)
  // Let's define the square around the current position.
  // We'll make the current position roughly the center, or a convenient starting point.
  // For a 20x20 square, we can define points relative to the current position (startX, startZ).
  // Let's make the current position the bottom-left corner of the square, then move clockwise.

  const p1 = {
    x: startX,
    y: startY,
    z: startZ
  }; // Current position
  const p2 = {
    x: startX + size,
    y: startY,
    z: startZ
  }; // Move positive X
  const p3 = {
    x: startX + size,
    y: startY,
    z: startZ + size
  }; // Move positive Z
  const p4 = {
    x: startX,
    y: startY,
    z: startZ + size
  }; // Move negative X

  const path = [p1, p2, p3, p4, p1]; // Return to start

  for (let i = 0; i < path.length; i++) {
    const target = path[i];
    await moveTo(target.x, target.y, target.z, range, 60); // 60 seconds timeout
  }
}