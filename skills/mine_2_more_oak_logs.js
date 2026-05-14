async function mine2MoreOakLogs(bot) {
  const targetX = 1635;
  const targetY = 82;
  const targetZ = 199;

  // Move to the specified location of the oak tree
  await moveTo(targetX, targetY, targetZ, 4, 60); // range 4 to be near the tree, 60s timeout

  // Mine 2 oak logs
  await mineBlock('oak_log', 2);
}