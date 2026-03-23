import { describe, it, expect } from 'vitest';

describe('CommandCenter', () => {
  it.todo('creates a command with valid fields');
  it.todo('rejects unknown command types');
  it.todo('transitions command through lifecycle states');
  it.todo('emits socket events on state changes');
  it.todo('persists commands to data/commands.json');
  it.todo('supports command cancellation');
  it.todo('fans out squad-scoped commands to individual bots');
});
