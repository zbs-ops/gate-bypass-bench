import { describe, expect, it } from 'vitest';
import { environmentSet, interpreterSet, launcherSet, optionSet, runBench, scriptSet, utilitySet, wrapperSet } from '../src/bench.js';

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

describe('the launcher set', () => {
  it('runs 12 attacks, all effective, and leaves the original 45 alone', () => {
    const extended = runBench(launcherSet());
    const cells = extended.cells.filter((c) => c.gate === 'allowlist');
    expect(cells).toHaveLength(12);
    expect(cells.every((c) => c.effective)).toBe(true);
    expect(runBench().cells.filter((c) => c.gate === 'allowlist' && c.effective)).toHaveLength(45);
  });

  it('the built-in allowlist holds, because it names neither find nor git', () => {
    const score = runBench(launcherSet()).scores.find((s) => s.gate === 'allowlist');
    expect(score?.bypasses).toBe(0);
  });

  it('an allowlist that names find and git by first word lets all 12 through', () => {
    // What a prefix allow rule does: judge the first word, nothing after it.
    const firstWord = {
      id: 'first-word-allowlist',
      describe: 'ALLOW if the first word is echo, ls, true, pwd, find or git',
      decide: (command: string) =>
        ['echo', 'ls', 'true', 'pwd', 'find', 'git'].includes(command.trim().split(/\s+/)[0] ?? '') ? 'ALLOW' : 'DENY',
    } as const;
    const report = runBench({ ...launcherSet(), gates: [firstWord] });
    expect(report.scores[0]?.bypasses).toBe(12);
    expect(report.scores[0]?.effectiveCommands).toBe(12);
  });
});

describe('the interpreter set', () => {
  it('leaves the original 45 alone', () => {
    expect(runBench().cells.filter((c) => c.gate === 'allowlist' && c.effective)).toHaveLength(45);
  });

  it('the built-in allowlist holds, because it names no interpreter', () => {
    const score = runBench(interpreterSet()).scores.find((s) => s.gate === 'allowlist');
    expect(score?.bypasses).toBe(0);
  });

  it('an allowlist that names python3, node and perl by first word lets every effective one through', () => {
    const firstWord = {
      id: 'first-word-allowlist',
      describe: 'ALLOW if the first word is echo, ls, true, pwd, python3, node or perl',
      decide: (command: string) =>
        ['echo', 'ls', 'true', 'pwd', 'python3', 'node', 'perl'].includes(command.trim().split(/\s+/)[0] ?? '')
          ? 'ALLOW'
          : 'DENY',
    } as const;
    const report = runBench({ ...interpreterSet(), gates: [firstWord] });
    // At least perl is on a standard Linux box, so some are effective, and all of those get through.
    expect(report.scores[0]?.effectiveCommands).toBeGreaterThan(0);
    expect(report.scores[0]?.bypasses).toBe(report.scores[0]?.effectiveCommands);
  });
});

describe('the utility set', () => {
  it('leaves the original 45 alone', () => {
    expect(runBench().cells.filter((c) => c.gate === 'allowlist' && c.effective)).toHaveLength(45);
  });

  it('the built-in allowlist holds, because it names none of sed, tar or make', () => {
    const score = runBench(utilitySet()).scores.find((s) => s.gate === 'allowlist');
    expect(score?.bypasses).toBe(0);
  });

  it('GNU sed and tar alone give 6 effective attacks on any Linux box', () => {
    const effective = runBench(utilitySet()).cells.filter(
      (c) => c.gate === 'allowlist' && c.effective && c.mutator !== 'make-eval',
    );
    expect(effective).toHaveLength(6);
  });

  it('an allowlist that names sed, tar and make by first word lets every effective one through', () => {
    const firstWord = {
      id: 'first-word-allowlist',
      describe: 'ALLOW if the first word is echo, ls, true, pwd, sed, tar or make',
      decide: (command: string) =>
        ['echo', 'ls', 'true', 'pwd', 'sed', 'tar', 'make'].includes(command.trim().split(/\s+/)[0] ?? '')
          ? 'ALLOW'
          : 'DENY',
    } as const;
    const report = runBench({ ...utilitySet(), gates: [firstWord] });
    expect(report.scores[0]?.effectiveCommands).toBeGreaterThanOrEqual(6);
    expect(report.scores[0]?.bypasses).toBe(report.scores[0]?.effectiveCommands);
  });
});

describe('the option set', () => {
  // An allowlist that names git, node and python3 by first word but refuses the obvious
  // inline-code flags, the way several real gates do.
  const flagAware = {
    id: 'allowlist-minus-inline-flags',
    describe: 'ALLOW echo, ls, true, pwd, git, node, python3 by first word, unless an inline-code flag appears',
    decide: (command: string) => {
      const words = command.trim().split(/\s+/);
      const first = words[0] ?? '';
      if (!['echo', 'ls', 'true', 'pwd', 'git', 'node', 'python3'].includes(first)) return 'DENY';
      return words.some((w) => ['-c', '-e', '-p', '--eval', '--print'].includes(w)) ? 'DENY' : 'ALLOW';
    },
  } as const;

  it('leaves the original 45 alone', () => {
    expect(runBench().cells.filter((c) => c.gate === 'allowlist' && c.effective)).toHaveLength(45);
  });

  it('the built-in allowlist holds, because it names none of git, node or python3', () => {
    const score = runBench(optionSet()).scores.find((s) => s.gate === 'allowlist');
    expect(score?.bypasses).toBe(0);
  });

  it('a gate that blocks inline-code flags stops the interpreter set where it runs', () => {
    const report = runBench({ ...interpreterSet(), gates: [flagAware] });
    expect(report.scores[0]?.effectiveCommands).toBeGreaterThan(0);
    expect(report.scores[0]?.bypasses).toBe(0);
  });

  it('the same gate lets every effective option attack through', () => {
    const report = runBench({ ...optionSet(), gates: [flagAware] });
    // git (delete, chmod) and node (all three) are on any machine this runs on; python3 adds 3.
    expect(report.scores[0]?.effectiveCommands).toBeGreaterThanOrEqual(5);
    expect(report.scores[0]?.bypasses).toBe(report.scores[0]?.effectiveCommands);
  });
});

describe('the environment set', () => {
  // The flag-aware allowlist from the option set, but reading the program the way a shell does:
  // leading NAME=value words are assignments, so the program is the first word after them.
  const ALLOWED = ['echo', 'ls', 'true', 'pwd', 'git', 'node', 'perl'];
  const INLINE = ['-c', '-e', '-p', '--eval', '--print'];
  const programOf = (command: string): string[] => {
    // Assignments can hold quoted spaces (NAME='a b'), so drop each one whole before splitting.
    let rest = command.trim();
    for (;;) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*=('[^']*'|"[^"]*"|\S*)\s+/.exec(rest);
      if (!m) break;
      rest = rest.slice(m[0].length);
    }
    return rest.split(/\s+/);
  };
  const assignmentAware = {
    id: 'allowlist-skipping-assignments',
    describe: 'ALLOW echo, ls, true, pwd, git, node, perl, read after any NAME=value words, unless an inline-code flag appears',
    decide: (command: string) => {
      const words = programOf(command);
      if (!ALLOWED.includes(words[0] ?? '')) return 'DENY';
      return words.some((w) => INLINE.includes(w)) ? 'DENY' : 'ALLOW';
    },
  } as const;

  it('the built-in allowlist holds, because it refuses quotes and names none of git, node or perl', () => {
    expect(runBench(environmentSet()).scores.find((s) => s.gate === 'allowlist')?.bypasses).toBe(0);
  });

  it('the assignment-aware gate still refuses the plain commands and the interpreter one-liners', () => {
    expect(assignmentAware.decide('rm protected.dat')).toBe('DENY');
    expect(assignmentAware.decide('FOO=1 rm protected.dat')).toBe('DENY');
    const report = runBench({ ...interpreterSet(), gates: [assignmentAware] });
    expect(report.scores[0]?.bypasses).toBe(0);
  });

  it('lets every effective environment attack through', () => {
    const report = runBench({ ...environmentSet(), gates: [assignmentAware] });
    // git (delete, chmod), node (all three) and perl (all three) are on any machine this runs on.
    expect(report.scores[0]?.effectiveCommands).toBe(8);
    expect(report.scores[0]?.bypasses).toBe(8);
  });
});
