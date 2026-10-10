import { Buffer } from 'node:buffer';
import type { Mutator } from './types.js';

/**
 * Each mutator rewrites `<binary> <args>` into a line that a POSIX shell runs with the
 * same effect, but that no longer contains the binary as a clean, matchable word. These
 * are the families catalogued in the shell-denylist-fragility literature (see README):
 * command chaining, inline quoting, line continuation, $IFS splitting, variable
 * indirection, interpreter hand-off (awk, sh), encoding, and argument piping.
 *
 * None of them reach outside the sandbox: they only re-spell a command whose arguments
 * are the sandbox-local files the intent created.
 */

const join = (binary: string, args: string[]) => [binary, ...args].join(' ');

export function makeMutators(): Mutator[] {
  return [
    {
      id: 'identity',
      describe: 'The command as written (control: should be caught by anything)',
      render: (b, a) => join(b, a),
    },
    {
      id: 'chain-prefix',
      describe: 'Hide the real command after a harmless one and a semicolon',
      render: (b, a) => `true; ${join(b, a)}`,
    },
    {
      id: 'line-continuation',
      describe: 'Split the binary name with a backslash-newline the shell removes',
      render: (b, a) => `${b[0]}\\\n${b.slice(1)} ${a.join(' ')}`,
    },
    {
      id: 'empty-quotes',
      describe: "Break the binary name with empty quotes (r''m)",
      render: (b, a) => `${b[0]}''${b.slice(1)} ${a.join(' ')}`,
    },
    {
      id: 'ifs-split',
      describe: 'Replace spaces with ${IFS} so there are no literal spaces',
      render: (b, a) => [b, ...a].join('${IFS}'),
    },
    {
      id: 'var-indirection',
      describe: 'Assemble the binary name in a variable and call it',
      render: (b, a) => `__c=${b}; "$__c" ${a.join(' ')}`,
    },
    {
      id: 'awk-system',
      describe: 'Shell out through awk\'s system()',
      render: (b, a) => `awk 'BEGIN{system("${join(b, a)}")}'`,
    },
    {
      id: 'base64-pipe',
      describe: 'Base64-encode the command and decode it into a shell',
      render: (b, a) => `echo ${Buffer.from(join(b, a)).toString('base64')} | base64 -d | sh`,
    },
    {
      id: 'xargs',
      describe: 'Feed the arguments to the binary through xargs',
      render: (b, a) => `printf '%s\\n' ${a.join(' ')} | xargs ${b}`,
    },
  ];
}
