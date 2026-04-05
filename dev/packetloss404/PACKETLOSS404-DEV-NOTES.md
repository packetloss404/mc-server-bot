packetloss404 dev notes for mc-server-bot

How to Use Building Features:

  1. Drop .schem or .schematic files into D:\projects\mc-server-bot\schematics\
  2. In-game, say: list schematics — packetsloth will list available files
  3. Say: build bunker.schem — it'll build the schematic at its current position

 It builds block-by-block. If the bot doesn't have the blocks in inventory, it falls back to /setblock commands (needs the bot to have server permissions for that). If the server allows the bots to use /setblock, it can build anything regardless of inventory.

