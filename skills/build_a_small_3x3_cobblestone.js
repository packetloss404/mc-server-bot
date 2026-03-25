async function buildSmallCobblestoneShelter(bot) {
  const getCobbleCount = () => {
    const item = bot.inventory.items().find(i => i.name === 'cobblestone');
    return item ? item.count : 0;
  };
  const needed = 16;
  if (getCobbleCount() < needed) {
    await mineBlock('stone', needed - getCobbleCount());
  }
  const pos = bot.entity.position.floored();
  const ox = pos.x + 2;
  const oy = pos.y;
  const oz = pos.z + 2;
  const structure = [];
  // Build 2 layers of a 3x3 outer ring
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 3; x++) {
      for (let z = 0; z < 3; z++) {
        // Only the perimeter
        if (x === 0 || x === 2 || z === 0 || z === 2) {
          // Leave a gap for a door at (1, 0)
          if (x === 1 && z === 0) continue;
          structure.push({
            x: ox + x,
            y: oy + y,
            z: oz + z
          });
        }
      }
    }
  }
  for (const p of structure) {
    await placeItem('cobblestone', p.x, p.y, p.z);
  }
}