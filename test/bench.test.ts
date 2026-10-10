import { describe, expect, it } from 'vitest';
import { runBench } from '../src/bench.js';

const score = (gate: string) => {
  const report = runBench();
  const s = report.scores.find((x) => x.gate === gate);
  if (!s) throw new Error(`no score for ${gate}`);
  return s;
};

describe('the benchmark as a whole', () => {
  it('finds a real bypass in both denylist gates', () => {
    expect(score('substring-denylist').bypasses).toBeGreaterThan(0);
    expect(score('word-denylist').bypasses).toBeGreaterThan(0);
  });

  it('cannot bypass the allowlist (it fails closed)', () => {
    expect(score('allowlist').bypasses).toBe(0);
    expect(score('allowlist').bypassRate).toBe(0);
  });

  it('scores every gate against the same, non-empty set of effective commands', () => {
    const report = runBench();
    const effectiveCounts = report.scores.map((s) => s.effectiveCommands);
    expect(Math.min(...effectiveCounts)).toBeGreaterThan(0);
    expect(new Set(effectiveCounts).size).toBe(1);
  });

  it('only ever counts a bypass that both slipped the gate and caused the effect', () => {
    for (const c of runBench().cells) {
      if (c.bypass) {
        expect(c.verdict).toBe('ALLOW');
        expect(c.effective).toBe(true);
      }
    }
  });
});
