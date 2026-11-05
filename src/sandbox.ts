import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Run one command in a throwaway directory and decide, while that directory still exists,
 * whether the forbidden effect occurred.
 *
 * The directory is the command's working directory, and the only files any intent names
 * are the ones `setup` just created there, so a command can only touch its own sandbox.
 * A trimmed PATH and a short timeout keep a runaway rewrite contained. The effect check
 * has to run before cleanup, because it reads files the command may have changed. The
 * directory is always removed, pass or fail.
 */
export function runAndCheck(
  command: string,
  setup: (dir: string) => void,
  effectHappened: (dir: string, stdout: string) => boolean,
): { effective: boolean; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gbb-'));
  try {
    setup(dir);
    let stdout = '';
    try {
      stdout = execFileSync('sh', ['-c', command], {
        cwd: dir,
        timeout: 5_000,
        // /usr/bin:/bin first, so a name there resolves exactly as before; /usr/local/bin is
        // appended because that's where a real agent's shell finds interpreters like node, and
        // an attack that runs a forbidden command through one has to be able to find it.
        env: { PATH: '/usr/bin:/bin:/usr/local/bin' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (err) {
      // A non-zero exit still counts: the effect check, not the exit code, is ground truth.
      stdout = (err as { stdout?: string }).stdout ?? '';
    }
    return { effective: effectHappened(dir, stdout), stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
