import type { Gate } from './types.js';

/** The binaries these gates are trying to keep an agent from running. */
export const BLOCKED_BINARIES = ['rm', 'cat', 'dd', 'curl', 'wget', 'chmod'];

/** The only binaries the allowlist gate will let through, with no shell features. */
const ALLOWED_BINARIES = ['echo', 'ls', 'true', 'pwd'];

const SHELL_METACHARACTERS = /[;&|`$(){}<>\\\n'"]/;

/**
 * Strip the shell-level disguises off the FIRST word of a command and return the bare binary
 * name it resolves to: quotes removed (`r''m` -> `rm`), backslashes removed (`\rm` -> `rm`),
 * and a path reduced to its basename (`/bin/rm` -> `rm`). This is what a careful team writes
 * when they decide to "canonicalize before matching". It closes the re-spelling tricks. It
 * does nothing about a different binary that has the same effect, or about the real command
 * hiding inside eval/awk/base64 where it isn't the first word at all.
 */
export function resolveFirstBinary(command: string): string {
  const firstWord = command.trim().split(/\s+/)[0] ?? '';
  const unquoted = firstWord.replace(/['"\\]/g, '');
  const basename = unquoted.includes('/') ? unquoted.slice(unquoted.lastIndexOf('/') + 1) : unquoted;
  return basename;
}

/**
 * Four gates, from the naive to the strict:
 *
 *  - substring: the first thing people write, and the most fragile.
 *  - word: the "fixed it" version that matches whole words. Still a denylist.
 *  - tokenized: canonicalizes the first word before matching. Closes re-spelling,
 *    still blind to equivalent binaries and interpreter hand-off.
 *  - allowlist: names what may run and refuses everything else (fails closed).
 *
 * The benchmark shows each denylist leaks somewhere and only the allowlist doesn't.
 */
export function makeGates(): Gate[] {
  return [
    {
      id: 'substring-denylist',
      describe: 'DENY if a blocked name appears anywhere in the string',
      decide: (command) =>
        BLOCKED_BINARIES.some((b) => command.includes(b)) ? 'DENY' : 'ALLOW',
    },
    {
      id: 'word-denylist',
      describe: 'DENY if a blocked name appears as a whitespace-delimited word',
      decide: (command) => {
        const words = command.split(/\s+/);
        return words.some((w) => BLOCKED_BINARIES.includes(w)) ? 'DENY' : 'ALLOW';
      },
    },
    {
      id: 'tokenized-denylist',
      describe: 'DENY if the first word, with quotes/backslashes/path stripped, is blocked',
      decide: (command) =>
        BLOCKED_BINARIES.includes(resolveFirstBinary(command)) ? 'DENY' : 'ALLOW',
    },
    {
      id: 'allowlist',
      describe: 'ALLOW only a single known binary with no shell metacharacters',
      decide: (command) => {
        if (SHELL_METACHARACTERS.test(command)) return 'DENY';
        const [binary, ...rest] = command.trim().split(/\s+/);
        if (binary === undefined) return 'DENY';
        if (!ALLOWED_BINARIES.includes(binary)) return 'DENY';
        return rest.every((a) => /^[\w./-]+$/.test(a)) ? 'ALLOW' : 'DENY';
      },
    },
  ];
}
