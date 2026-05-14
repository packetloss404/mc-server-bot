async function mineOakLogsAtSpecificLocation(bot) {
  const targetX = 1646;
  const targetY = 79;
  const targetZ = 152;
  const blockName = 'oak_log';
  const count = 5;

  // Move to the vicinity of the known oak tree
  // The critique indicates the bot was at 1646, 84, 152, which is 5 blocks above the target Y.
  // We need to ensure we are at the correct Y level or within a reasonable range for mineBlock to find it.
  // Let's move to the exact coordinates first, or at least close enough.
  await moveTo(targetX, targetY, targetZ, 2, 30); // Move within 2 blocks of the exact target Y, 30 sec timeout

  // Now that we are near the exact coordinates, try to find and mine the block.
  // mineBlock primitive will search within 32 blocks from the current position.
  // If the tree was already mined, it might not be there.
  // The task specifically asks to mine from the *nearest known oak tree at* this location.
  // This implies the block should be there or nearby.
  await mineBlock(blockName, count);
}