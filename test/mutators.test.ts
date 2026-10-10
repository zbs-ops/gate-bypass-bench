import { describe, expect, it } from 'vitest';
import { makeIntents } from '../src/intents.js';
import { makeMutators } from '../src/mutators.js';
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
