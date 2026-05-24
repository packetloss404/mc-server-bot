import { describe, it, expect } from 'vitest';

import { ImpersonationMonitor } from '../../src/security/ImpersonationMonitor';

describe('ImpersonationMonitor', () => {
  it('opens a new incident on first signal', () => {
    const m = new ImpersonationMonitor();
    const { isNew, incident } = m.record(
      { botName: 'Greta', signal: 'duplicate-login', reason: 'duplicate_login' },
      1000,
    );
    expect(isNew).toBe(true);
    expect(incident.count).toBe(1);
    expect(incident.botName).toBe('Greta');
    expect(m.list()).toHaveLength(1);
  });

  it('folds repeats within the dedup window into one incident', () => {
    const m = new ImpersonationMonitor(30_000);
    const first = m.record({ botName: 'Greta', signal: 'duplicate-login', reason: 'r1' }, 1000);
    const second = m.record({ botName: 'Greta', signal: 'ghost-name', reason: 'r2' }, 5000);

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.incident.count).toBe(2);
    // Latest detail is surfaced.
    expect(second.incident.reason).toBe('r2');
    expect(second.incident.signal).toBe('ghost-name');
    expect(second.incident.firstAt).toBe(1000);
    expect(second.incident.lastAt).toBe(5000);
    // Still a single incident in history.
    expect(m.list()).toHaveLength(1);
  });

  it('opens a fresh incident once the dedup window elapses', () => {
    const m = new ImpersonationMonitor(30_000);
    m.record({ botName: 'Greta', signal: 'duplicate-login', reason: 'r1' }, 1000);
    const later = m.record({ botName: 'Greta', signal: 'duplicate-login', reason: 'r2' }, 40_000);

    expect(later.isNew).toBe(true);
    expect(later.incident.count).toBe(1);
    expect(m.list()).toHaveLength(2);
  });

  it('tracks incidents per bot independently and is case-insensitive', () => {
    const m = new ImpersonationMonitor();
    m.record({ botName: 'Greta', signal: 'duplicate-login', reason: 'r' }, 1000);
    const quinn = m.record({ botName: 'Quinn', signal: 'duplicate-login', reason: 'r' }, 1000);
    expect(quinn.isNew).toBe(true);

    expect(m.getForBot('greta')).toBeDefined();
    expect(m.getForBot('GRETA')!.botName).toBe('Greta');
    expect(m.getForBot('nobody')).toBeUndefined();
  });

  it('lists incidents newest-first and bounds history', () => {
    const m = new ImpersonationMonitor(0, 2); // window 0 => never folds; cap 2
    m.record({ botName: 'A', signal: 'duplicate-login', reason: 'r' }, 1);
    m.record({ botName: 'B', signal: 'duplicate-login', reason: 'r' }, 2);
    m.record({ botName: 'C', signal: 'duplicate-login', reason: 'r' }, 3);

    const list = m.list();
    expect(list).toHaveLength(2);
    expect(list[0].botName).toBe('C'); // newest first
    expect(list[1].botName).toBe('B');
  });
});
