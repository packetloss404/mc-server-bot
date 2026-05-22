import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  logger,
  loggerSampled,
  redactSecret,
  truncate,
  withContext,
} from './logger';

describe('redactSecret', () => {
  it('returns empty string for empty input', () => {
    expect(redactSecret('')).toBe('');
  });

  it('fully masks short strings', () => {
    expect(redactSecret('short')).toBe('***');
    expect(redactSecret('12345678')).toBe('***');
  });

  it('masks the middle of long strings, keeping prefix and suffix', () => {
    expect(redactSecret('sk-abcd1234xR_x')).toBe('sk-***xR_x');
  });

  it('handles non-string input gracefully', () => {
    // @ts-expect-error - intentionally passing non-string
    expect(redactSecret(undefined)).toBe('');
    // @ts-expect-error - intentionally passing non-string
    expect(redactSecret(null)).toBe('');
  });
});

describe('truncate', () => {
  it('returns the original string when shorter than the limit', () => {
    expect(truncate('hello', 200)).toBe('hello');
  });

  it('returns the original string when exactly at the limit', () => {
    const s = 'x'.repeat(200);
    expect(truncate(s, 200)).toBe(s);
  });

  it('truncates and appends a marker with the dropped count', () => {
    const s = 'x'.repeat(250);
    const out = truncate(s, 200);
    expect(out.startsWith('x'.repeat(200))).toBe(true);
    expect(out.endsWith('[+50 more]')).toBe(true);
  });

  it('uses a default of 200 chars', () => {
    const s = 'a'.repeat(500);
    const out = truncate(s);
    expect(out.startsWith('a'.repeat(200))).toBe(true);
    expect(out).toContain('[+300 more]');
  });

  it('coerces non-string input', () => {
    // @ts-expect-error - intentionally passing non-string
    expect(truncate(12345, 200)).toBe('12345');
  });
});

describe('loggerSampled', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes only trace/debug/info methods', () => {
    const sampled = loggerSampled(1);
    expect(typeof sampled.trace).toBe('function');
    expect(typeof sampled.debug).toBe('function');
    expect(typeof sampled.info).toBe('function');
    expect((sampled as any).warn).toBeUndefined();
    expect((sampled as any).error).toBeUndefined();
  });

  it('always forwards when rate is 1', () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    const sampled = loggerSampled(1);
    sampled.info('hit');
    sampled.info('hit');
    sampled.info('hit');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('never forwards when rate is 0', () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    const sampled = loggerSampled(0);
    sampled.info('miss');
    sampled.info('miss');
    expect(spy).not.toHaveBeenCalled();
  });

  it('uses Math.random to gate emission at fractional rates', () => {
    const spy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
    const randomSpy = vi.spyOn(Math, 'random');
    randomSpy.mockReturnValueOnce(0.01); // < 0.5 -> emit
    randomSpy.mockReturnValueOnce(0.99); // >= 0.5 -> skip
    const sampled = loggerSampled(0.5);
    sampled.debug('a');
    sampled.debug('b');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('clamps invalid rates safely', () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    const overOne = loggerSampled(5);
    overOne.info('over');
    const negative = loggerSampled(-1);
    negative.info('neg');
    const nan = loggerSampled(Number.NaN);
    nan.info('nan');
    // over-one acts like 1 (always emit), negative and NaN act like 0.
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('withContext', () => {
  it('returns a child logger with the given bindings', () => {
    const child = withContext({ botName: 'Alice', taskId: 't-42' });
    expect(typeof child.info).toBe('function');
    expect(typeof child.child).toBe('function');
    const bindings = child.bindings();
    expect(bindings.botName).toBe('Alice');
    expect(bindings.taskId).toBe('t-42');
  });

  it('accepts arbitrary extra fields', () => {
    const child = withContext({ botName: 'Bob', custom: 123 });
    const bindings = child.bindings();
    expect(bindings.botName).toBe('Bob');
    expect(bindings.custom).toBe(123);
  });

  it('tolerates an empty/missing context', () => {
    // @ts-expect-error - intentionally passing undefined
    const child = withContext(undefined);
    expect(typeof child.info).toBe('function');
  });
});

describe('logger backwards compatibility', () => {
  it('still exposes the standard pino level methods', () => {
    expect(typeof logger.trace).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.fatal).toBe('function');
    expect(typeof logger.child).toBe('function');
  });
});
