async function mine5Stone(bot) {
  let stoneCount = 0;
  while (stoneCount < 5) {
    const stoneBlock = bot.findBlock({
      matching: block => block.name === 'stone',
      maxDistance: 32
    });
    if (!stoneBlock) {
      await exploreUntil(new Vec3(1, 0, 1), 60, () => {
        const found = bot.findBlock({
          matching: block => block.name === 'stone',
          maxDistance: 32
        });
        if (!found) { console.log("Block not found"); return; }
        return found ? found.position : null;
      });
      const newStoneBlock = bot.findBlock({
        matching: block => block.name === 'stone',
        maxDistance: 32
      });
      if (!newStoneBlock) {
        throw new Error("Could not find stone block after exploring.");
      }
      await mineBlock('stone', 1);
    } else {
      await mineBlock('stone', 1);
    }
    stoneCount++;
  }
}