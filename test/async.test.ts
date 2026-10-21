import { describe, expect, it } from 'vitest';
import { runBench, runBenchAsync } from '../src/bench.js';
import { makeGates } from '../src/gates.js';
import type { AsyncGate } from '../src/types.js';

/**
 * Real gates are often async: a policy engine that parses the command first, a service call,
 * a model acting as judge. runBenchAsync scores those with the same rules as runBench.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('runBenchAsync', () => {
  it('scores the built-in sync gates exactly like runBench', async () => {
    const sync = runBench();
    const async = await runBenchAsync();
    expect(async.scores).toEqual(sync.scores);
    expect(async.cells).toEqual(sync.cells);
  });

  it('awaits a gate that answers with a promise', async () => {
    const [substring] = makeGates();
    if (!substring) throw new Error('no gates');
    const slowSubstring: AsyncGate = {
      id: 'slow-substring',
      describe: substring.describe,
      decide: async (command) => {
        await sleep(1);
        return substring.decide(command);
      },
    };
    const report = await runBenchAsync({ gates: [substring, slowSubstring] });
    const [a, b] = report.scores;
    expect(b?.bypasses).toBe(a?.bypasses);
    expect(b?.effectiveCommands).toBe(a?.effectiveCommands);
  });

  it('fails loudly, naming the gate, when a gate throws instead of answering', async () => {
    const broken: AsyncGate = {
      id: 'broken-gate',
      describe: 'always errors',
      decide: async () => {
        throw new Error('engine not initialized');
      },
    };
    await expect(runBenchAsync({ gates: [broken] })).rejects.toThrow(/broken-gate/);
  });

  it('rejects a verdict that is neither ALLOW nor DENY rather than guessing', async () => {
    const asks: AsyncGate = {
      id: 'asks-user',
      describe: 'returns a third answer',
      decide: async () => 'ASK_USER' as unknown as 'ALLOW',
    };
    await expect(runBenchAsync({ gates: [asks] })).rejects.toThrow(/asks-user.*ASK_USER/);
  });
});
