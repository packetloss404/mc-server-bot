async function walkToPacket2(bot) {
  const player = bot.players['Packet2'];
  if (player && player.entity) {
    const pos = player.entity.position;
    await moveTo(pos.x, pos.y, pos.z, 2, 30);
  } else {
    const targetEntity = await exploreUntil({
      x: 1,
      y: 0,
      z: 0
    }, 60, () => {
      const p = bot.players['Packet2'];
      return p && p.entity ? p.entity : null;
    });
    if (targetEntity) {
      const pos = targetEntity.position;
      await moveTo(pos.x, pos.y, pos.z, 2, 30);
    }
  }
}