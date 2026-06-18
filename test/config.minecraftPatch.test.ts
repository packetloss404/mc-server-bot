import { describe, it, expect } from 'vitest';
import {
  PATCHABLE_SECTIONS,
  RESTART_REQUIRED_FIELDS,
  validatePatch,
  findRestartRequiredFields,
} from '../src/util/configPersist';

// The "switch Minecraft server" feature hinges on `minecraft` being a
// runtime-patchable section whose every field is restart-required (the values
// are only read at mineflayer.createBot).
describe('minecraft config patching', () => {
  it('exposes minecraft as a patchable section', () => {
    expect(PATCHABLE_SECTIONS).toContain('minecraft');
  });

  it('marks every minecraft field as restart-required', () => {
    const req = RESTART_REQUIRED_FIELDS.minecraft;
    for (const f of ['host', 'port', 'version', 'auth', 'loginFlow', 'loginPassword', 'selectClass']) {
      expect(req.has(f)).toBe(true);
    }
  });

  it('coerces a full server-switch patch (host/port/version/auth + onboarding)', () => {
    const r = validatePatch('minecraft', {
      host: '10.80.13.14', port: '25565', version: '1.21.11',
      auth: 'offline', loginFlow: 'none', selectClass: 'false',
    });
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({
      host: '10.80.13.14', port: 25565, version: '1.21.11',
      auth: 'offline', loginFlow: 'none', selectClass: false,
    });
  });

  it('rejects a non-numeric port', () => {
    const r = validatePatch('minecraft', { port: 'abc' });
    expect(r.ok).toBe(false);
  });

  it('reports the changed fields as needing a restart', () => {
    const changed = findRestartRequiredFields('minecraft', { host: '10.80.13.14', port: 25565 });
    expect(changed.sort()).toEqual(['host', 'port']);
  });
});
