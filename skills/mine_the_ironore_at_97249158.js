async function mineTheIronOreAt97249158(bot) {
  const targetX = 972;
  const targetY = 49;
  const targetZ = 158;

  // Move to the target coordinates first
  await moveTo(targetX, targetY, targetZ, 1, 60);

  // Once at the location, mine the iron_ore
  // The block name is 'iron_ore', not 'resource'
  await mineBlock('iron_ore', 1);
}