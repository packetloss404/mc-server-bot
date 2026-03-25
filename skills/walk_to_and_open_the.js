async function walkToAndOpenSpecificChest(bot) {
  const x = 907;
  const y = 81;
  const z = 396;
  await moveTo(x, y, z, 2, 60);
  await inspectContainer('chest');
}