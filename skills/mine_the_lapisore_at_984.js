async function mineLapisOreAt984(bot) {
  const targetPos = {
    x: 984,
    y: 62,
    z: 366
  };

  // Move to the position first to ensure the block is loaded and reachable
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 2, 30);

  // Use the primitive mineBlock which handles looking, tool selection, and digging
  // mineBlock finds the nearest block by name, so it will target the one we just moved to
  await mineBlock('lapis_ore', 1);
}