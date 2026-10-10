import type { Gate } from './types.js';

/** The binaries these gates are trying to keep an agent from running. */
export const BLOCKED_BINARIES = ['rm', 'cat', 'dd', 'curl', 'wget', 'chmod'];

/** The only binaries the allowlist gate will let through, with no shell features. */
const ALLOWED_BINARIES = ['echo', 'ls', 'true', 'pwd'];

const SHELL_METACHARACTERS = /[;&|`$(){}<>\\\n'"]/;

/**
 * Three gates, from the naive to the strict:
 *
 *  - substring: the first thing people write, and the most fragile.
 *  - word: the "fixed it" version that matches whole words. Still a denylist.
 *  - allowlist: names what may run and refuses everything else (fails closed).
 *
 * The point of the benchmark is to show the first two leak and the third does not.
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
