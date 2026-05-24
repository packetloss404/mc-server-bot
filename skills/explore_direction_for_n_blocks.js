// Parameterized replacement for the explore_<dir>_for_<N>_blocks family.
// Walks the bot `blocks` units in the chosen cardinal direction using
// exploreUntil(), with a fallback target near the start position. Pass
// direction as one of 'north' | 'south' | 'east' | 'west' (lower-case).
async function explore_direction_for_n_blocks(bot, direction, blocks) {
  if (typeof blocks !== 'number' || !isFinite(blocks) || blocks <= 0) {
    throw new Error('explore_direction_for_n_blocks: blocks must be a positive number');
  }
  const dir = String(direction || '').toLowerCase();
  const start = bot.entity.position.clone();
  let targetX = start.x;
  let targetZ = start.z;
  if (dir === 'east') targetX = start.x + blocks;
  else if (dir === 'west') targetX = start.x - blocks;
  else if (dir === 'south') targetZ = start.z + blocks;
  else if (dir === 'north') targetZ = start.z - blocks;
  else throw new Error('explore_direction_for_n_blocks: unknown direction ' + dir);

  // exploreUntil caps maxTime at 30s in the host; pass 30 explicitly to make
  // intent obvious and avoid relying on the cap.
  await exploreUntil(dir, 30, () => {
    const p = bot.entity.position;
    const dx = Math.abs(p.x - start.x);
    const dz = Math.abs(p.z - start.z);
    if (dir === 'east' || dir === 'west') {
      if (dx >= blocks) return { x: targetX, y: p.y, z: p.z };
    } else if (dir === 'north' || dir === 'south') {
      if (dz >= blocks) return { x: p.x, y: p.y, z: targetZ };
    }
    return null;
  });
}
