async function exploreToFindVillage(bot) {
  const startZ = bot.entity.position.z;
  const targetZ = startZ + 100;
  const villageWorkstations = ['bell', 'composter', 'lectern', 'fletching_table', 'grindstone', 'smithing_table', 'smoker', 'blast_furnace', 'cartography_table', 'brewing_stand', 'cauldron', 'loom', 'stonecutter'];
  await exploreUntil({
    x: 0,
    y: 0,
    z: 1
  }, 300, () => {
    const foundBlock = bot.findBlock({
      matching: b => villageWorkstations.includes(b.name),
      maxDistance: 32
    });
    return !!foundBlock || bot.entity.position.z >= targetZ;
  });
}