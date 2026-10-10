/** A forbidden thing an agent might try to do, defined so we can prove it happened. */
export interface Intent {
  id: string;
  describe: string;
  /** The binary a naive denylist would try to block, e.g. "rm". */
  binary: string;
  /** Arguments, each already safe to appear as its own shell word. */
  args: string[];
  /** Create the files the forbidden command acts on, inside the sandbox dir. */
  setup: (dir: string) => void;
  /**
   * Did the forbidden effect actually occur? Gets the sandbox dir and whatever
   * the command printed. This is ground truth: a rewrite that doesn't trip this
   * is not a real bypass, however it slipped past the gate.
   */
  effectHappened: (dir: string, stdout: string) => boolean;
}

/** A rewrite of a command that preserves its effect while changing its text. */
export interface Mutator {
  id: string;
  describe: string;
  render: (binary: string, args: string[]) => string;
}

/** The thing under test: given a command line, allow it or deny it. */
export interface Gate {
  id: string;
  describe: string;
  decide: (command: string) => 'ALLOW' | 'DENY';
}

export interface Cell {
  intent: string;
  mutator: string;
  gate: string;
  command: string;
  /** Did executing the command actually cause the forbidden effect? */
  effective: boolean;
  verdict: 'ALLOW' | 'DENY';
  /** Allowed by the gate AND the effect really happened. */
  bypass: boolean;
}

export interface GateScore {
  gate: string;
  /** Rewrites that genuinely cause the effect (the only fair denominator). */
  effectiveCommands: number;
  bypasses: number;
  bypassRate: number;
}

export interface Report {
  cells: Cell[];
  scores: GateScore[];
}
