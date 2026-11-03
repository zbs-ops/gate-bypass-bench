import { describe, expect, it } from 'vitest';
import { makeIntents } from '../src/intents.js';
import { makeLauncherMutators, makeMutators, makeScriptMutators, makeWrapperMutators } from '../src/mutators.js';
import { runAndCheck } from '../src/sandbox.js';

const deleteIntent = () => {
  const i = makeIntents().find((x) => x.id === 'delete-protected');
  if (!i) throw new Error('no delete intent');
  return i;
};

describe('mutators preserve the forbidden effect', () => {
  // This is the benchmark's honesty check: a rewrite only counts if it still does the
  // damage. Every mutator must reproduce the delete on this shell, or the scorecard would
  // be crediting gates for blocking commands that were harmless anyway.
  it.each(makeMutators().map((m) => [m.id, m] as const))('%s still deletes', (_id, mutator) => {
    const intent = deleteIntent();
    const command = mutator.render(intent.binary, intent.args);
    const { effective } = runAndCheck(command, intent.setup, intent.effectHappened);
    expect(effective, `command was a no-op: ${command}`).toBe(true);
  });
});

describe('identity mutator', () => {
  it('renders the command verbatim', () => {
    const identity = makeMutators().find((m) => m.id === 'identity');
    expect(identity?.render('rm', ['a', 'b'])).toBe('rm a b');
  });
});

describe('wrapper mutators', () => {
  // Same honesty check, on every intent: a wrapper only counts if the wrapped command still
  // does the damage.
  const cases = makeIntents().flatMap((intent) =>
    makeWrapperMutators().map((m) => [`${m.id} / ${intent.id}`, m, intent] as const),
  );
  it.each(cases)('%s still has the effect', (_name, mutator, intent) => {
    const command = mutator.render(intent.binary, intent.args);
    const { effective } = runAndCheck(command, intent.setup, intent.effectHappened);
    expect(effective, `command was a no-op: ${command}`).toBe(true);
  });

  it('is kept out of the original set, so published scorecards do not move', () => {
    const core = makeMutators().map((m) => m.id);
    expect(makeWrapperMutators().every((m) => !core.includes(m.id))).toBe(true);
    expect(core).toHaveLength(13);
  });
});

describe('script-file mutators', () => {
  // The same honesty check on every intent: writing the command into a script and running
  // the script only counts if the effect still happens.
  const cases = makeIntents().flatMap((intent) =>
    makeScriptMutators().map((m) => [`${m.id} / ${intent.id}`, m, intent] as const),
  );
  it.each(cases)('%s still has the effect', (_name, mutator, intent) => {
    const command = mutator.render(intent.binary, intent.args);
    const { effective } = runAndCheck(command, intent.setup, intent.effectHappened);
    expect(effective, `command was a no-op: ${command}`).toBe(true);
  });

  it('writes its script inside the sandbox, not elsewhere', () => {
    for (const m of makeScriptMutators()) {
      const command = m.render('rm', ['x']);
      expect(command).not.toMatch(/\s\/|\.\.\//); // no absolute or parent paths
    }
  });

  it('only base64-script keeps the binary off the command line', () => {
    const render = (id: string) => makeScriptMutators().find((m) => m.id === id)!.render('rm', ['protected.dat']);
    expect(render('base64-script')).not.toContain('rm');
    expect(render('script-write-run')).toContain('rm protected.dat');
  });

  it('is kept out of the original and wrapper sets, so published scorecards do not move', () => {
    const taken = [...makeMutators(), ...makeWrapperMutators()].map((m) => m.id);
    expect(makeScriptMutators().every((m) => !taken.includes(m.id))).toBe(true);
    expect(makeScriptMutators()).toHaveLength(4);
  });
});

describe('launcher mutators', () => {
  // The same honesty check on every intent: running the command from find or git only counts
  // if the effect still happens.
  const cases = makeIntents().flatMap((intent) =>
    makeLauncherMutators().map((m) => [`${m.id} / ${intent.id}`, m, intent] as const),
  );
  it.each(cases)('%s still has the effect', (_name, mutator, intent) => {
    const command = mutator.render(intent.binary, intent.args);
    const { effective } = runAndCheck(command, intent.setup, intent.effectHappened);
    expect(effective, `command was a no-op: ${command}`).toBe(true);
  });

  it('starts every command with find or git, the program an allowlist would name', () => {
    for (const m of makeLauncherMutators()) {
      expect(m.render('chmod', ['777', 'x']).split(' ')[0]).toMatch(/^(find|git)$/);
    }
  });

  it('keeps find to the sandbox folder, so the command runs once and nowhere else', () => {
    for (const m of makeLauncherMutators().filter((x) => x.id.startsWith('find'))) {
      expect(m.render('chmod', ['777', 'x'])).toMatch(/^find \. -maxdepth 0 /);
    }
  });

  it('is kept out of the other sets, so published scorecards do not move', () => {
    const taken = [...makeMutators(), ...makeWrapperMutators(), ...makeScriptMutators()].map((m) => m.id);
    expect(makeLauncherMutators().every((m) => !taken.includes(m.id))).toBe(true);
    expect(makeLauncherMutators()).toHaveLength(4);
  });
});
