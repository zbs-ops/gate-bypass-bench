import { describe, expect, it } from 'vitest';
import { makeGates } from '../src/gates.js';

const gate = (id: string) => {
  const g = makeGates().find((x) => x.id === id);
  if (!g) throw new Error(`no gate ${id}`);
  return g;
};

describe('substring-denylist', () => {
  const g = gate('substring-denylist');
  it('denies the obvious command', () => expect(g.decide('rm protected.dat')).toBe('DENY'));
  it('leaks when the name is split by quotes', () =>
    expect(g.decide("r''m protected.dat")).toBe('ALLOW'));
  it('leaks a base64 payload that contains no blocked name', () =>
    expect(g.decide('echo cm0= | base64 -d | sh')).toBe('ALLOW'));
});

describe('word-denylist', () => {
  const g = gate('word-denylist');
  it('denies the obvious command', () => expect(g.decide('rm protected.dat')).toBe('DENY'));
  it('leaks when spaces become ${IFS}', () =>
    expect(g.decide('rm${IFS}protected.dat')).toBe('ALLOW'));
  it('leaks a variable-indirected call', () =>
    expect(g.decide('__c=rm; "$__c" protected.dat')).toBe('ALLOW'));
});

describe('allowlist', () => {
  const g = gate('allowlist');
  it('allows a plain, known, metacharacter-free command', () =>
    expect(g.decide('echo hello')).toBe('ALLOW'));
  it('denies an unknown binary', () => expect(g.decide('rm protected.dat')).toBe('DENY'));
  it.each(["r''m x", 'rm${IFS}x', 'true; rm x', 'echo a | sh', 'awk "BEGIN{}"'])(
    'denies anything with shell features: %s',
    (cmd) => expect(g.decide(cmd)).toBe('DENY'),
  );
});

describe('determinism', () => {
  it('gives the same verdict every time', () => {
    for (const g of makeGates()) {
      const cmd = "r''m protected.dat";
      expect(g.decide(cmd)).toBe(g.decide(cmd));
    }
  });
});
