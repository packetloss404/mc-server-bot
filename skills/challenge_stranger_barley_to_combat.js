async function challengeBarleyToCombat(bot) {
  // Find Barley in nearby players
  let barley = Object.values(bot.players).find(p => p.entity && p.username === 'Barley');

  // If not found, explore to find Barley
  if (!barley) {
    await exploreUntil('forward', 30, () => {
      return Object.values(bot.players).find(p => p.entity && p.username === 'Barley');
    });
    barley = Object.values(bot.players).find(p => p.entity && p.username === 'Barley');
  }
  if (!barley || !barley.entity) {
    return;
  }

  // Move to Barley
  await moveTo(barley.entity.position.x, barley.entity.position.y, barley.entity.position.z, 1, 30);

  // Equip a weapon if we have one, otherwise craft a wooden sword
  let weapon = bot.inventory.items().find(i => i.name.includes('sword'));
  if (!weapon) {
    await craftItem('wooden_sword', 1);
    weapon = bot.inventory.items().find(i => i.name === 'wooden_sword');
  }
  if (weapon) {
    const weaponObj = bot.inventory.items().find(i => i.name === weapon.name);
    await bot.equip(weaponObj, 'hand');
  }

  // Attack Barley to initiate combat
  await killMob('player', 60);
}