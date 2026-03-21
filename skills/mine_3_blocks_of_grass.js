async function mine3BlocksOfGrass(bot) {
  try {
    await mineBlock("grass_block", 3);
    bot.chat("Mined 3 grass blocks.");
  } catch (err) {
    console.error('Error mining grass_block:', err);
    bot.chat("Failed to mine grass blocks.");
  }
}
