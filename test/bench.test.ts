import { describe, expect, it } from 'vitest';
import { runBench, scriptSet, wrapperSet } from '../src/bench.js';

const score = (gate: string) => {
  const report = runBench();
  const s = report.scores.find((x) => x.gate === gate);
  if (!s) throw new Error(`no score for ${gate}`);
  return s;
};

describe('the benchmark as a whole', () => {
  it('finds a real bypass in every denylist gate, including the canonicalizing one', () => {
    expect(score('substring-denylist').bypasses).toBeGreaterThan(0);
    expect(score('word-denylist').bypasses).toBeGreaterThan(0);
    expect(score('tokenized-denylist').bypasses).toBeGreaterThan(0);
  });

  it('shows canonicalization helps but is not enough: tokenized beats word, still leaks', () => {
    // Stripping quotes/paths off the first word closes the cosmetic rewrites, so the
    // tokenized gate should do better than the word denylist. But equivalent binaries and
    // interpreter hand-off still get through, so it is nowhere near the allowlist's 0%.
    expect(score('tokenized-denylist').bypassRate).toBeLessThan(score('word-denylist').bypassRate);
    expect(score('tokenized-denylist').bypassRate).toBeGreaterThan(0.2);
  });

  it('the equivalent-binary attacks defeat every denylist', () => {
    // unlink/find/head/sed never mention a blocked binary, so no denylist sees them.
    const equivalentBypasses = runBench().cells.filter(
      (c) => c.mutator.startsWith('equivalent:') && c.gate.endsWith('denylist') && c.bypass,
    );
    expect(equivalentBypasses.length).toBeGreaterThan(0);
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

describe('the wrapper set', () => {
  it('runs 12 attacks, all effective, and leaves the original 45 alone', () => {
    const extended = runBench(wrapperSet());
    const cells = extended.cells.filter((c) => c.gate === 'allowlist');
    expect(cells).toHaveLength(12);
    expect(cells.every((c) => c.effective)).toBe(true);
    expect(runBench().cells.filter((c) => c.gate === 'allowlist' && c.effective)).toHaveLength(45);
  });

  it('gets past a first-word denylist but not the allowlist', () => {
    const score = (id: string) => runBench(wrapperSet()).scores.find((s) => s.gate === id);
    expect(score('tokenized-denylist')?.bypasses).toBe(12);
    expect(score('allowlist')?.bypasses).toBe(0);
  });
});

describe('the script-file set', () => {
  it('runs 12 attacks, all effective, and leaves the original 45 alone', () => {
    const extended = runBench(scriptSet());
    const cells = extended.cells.filter((c) => c.gate === 'allowlist');
    expect(cells).toHaveLength(12);
    expect(cells.every((c) => c.effective)).toBe(true);
    expect(runBench().cells.filter((c) => c.gate === 'allowlist' && c.effective)).toHaveLength(45);
  });

  it('defeats every denylist but not the allowlist', () => {
    const score = (id: string) => runBench(scriptSet()).scores.find((s) => s.gate === id);
    // A command-line parser can't see into a file: the tokenized denylist misses all 12.
    expect(score('tokenized-denylist')?.bypasses).toBe(12);
    expect(score('allowlist')?.bypasses).toBe(0);
  });
});
