import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs before importing the module so AffinityManager never touches disk
vi.mock('fs', () => {
  const fns = {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
  return { default: fns, ...fns };
});

import { AffinityManager } from '../../src/personality/AffinityManager';
import type { Config } from '../../src/config';

const affinityConfig: Config['affinity'] = {
  default: 50,
  hitPenalty: 10,
  chatBonus: 2,
  giftBonus: 5,
  negativeSentimentPenalty: 5,
  hostileThreshold: 20,
  trustThreshold: 70,
};

describe('AffinityManager.onHelpRequest', () => {
  let mgr: AffinityManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new AffinityManager(affinityConfig, '/tmp/dyobot-test-affinity');
  });

  it('records a help_request event accessible via getRelationshipSummary', () => {
    mgr.onHelpRequest('Botty', 'Steve', 'needs help mining');
    const summary = mgr.getRelationshipSummary('Botty', 'Steve');
    expect(summary).toContain('1 help request');
  });

  it('uses singular form after one call and plural form after three calls', () => {
    mgr.onHelpRequest('Botty', 'Steve');
    const singular = mgr.getRelationshipSummary('Botty', 'Steve');
    expect(singular).toContain('1 help request');
    expect(singular).not.toContain('1 help requests');

    mgr.onHelpRequest('Botty', 'Steve');
    mgr.onHelpRequest('Botty', 'Steve');
    const plural = mgr.getRelationshipSummary('Botty', 'Steve');
    expect(plural).toContain('3 help requests');
  });

  it('stores the detail string on the recorded event', () => {
    mgr.onHelpRequest('Botty', 'Steve', 'lost in a cave');

    const eventsMap = (mgr as any).events as Map<string, Array<{ type: string; detail?: string }>>;
    const events = eventsMap.get('botty:steve');

    expect(events).toBeDefined();
    expect(events!.length).toBe(1);
    expect(events![0].type).toBe('help_request');
    expect(events![0].detail).toBe('lost in a cave');
  });

  it('omits detail when none is provided', () => {
    mgr.onHelpRequest('Botty', 'Steve');

    const eventsMap = (mgr as any).events as Map<string, Array<{ type: string; detail?: string }>>;
    const events = eventsMap.get('botty:steve');

    expect(events).toBeDefined();
    expect(events![0].type).toBe('help_request');
    expect(events![0].detail).toBeUndefined();
  });

  it('tracks multiple players independently for the same bot', () => {
    mgr.onHelpRequest('Botty', 'Steve', 'first help');
    mgr.onHelpRequest('Botty', 'Alex', 'unrelated help');
    mgr.onHelpRequest('Botty', 'Alex', 'more help');

    const steveSummary = mgr.getRelationshipSummary('Botty', 'Steve');
    const alexSummary = mgr.getRelationshipSummary('Botty', 'Alex');

    expect(steveSummary).toContain('1 help request');
    expect(steveSummary).not.toContain('2 help');
    expect(alexSummary).toContain('2 help requests');
  });

  it('does not change the affinity score', () => {
    const before = mgr.get('Botty', 'Steve');
    expect(before).toBe(affinityConfig.default);

    mgr.onHelpRequest('Botty', 'Steve', 'one');
    mgr.onHelpRequest('Botty', 'Steve', 'two');
    mgr.onHelpRequest('Botty', 'Steve', 'three');

    const after = mgr.get('Botty', 'Steve');
    expect(after).toBe(before);
    expect(after).toBe(affinityConfig.default);
  });
});
