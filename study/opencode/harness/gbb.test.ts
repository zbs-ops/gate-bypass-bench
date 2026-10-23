/**
 * Ask opencode's own code what it would do with each benchmark command.
 *
 * Copied into packages/opencode/test/tool/ of an opencode checkout (tag v1.19.4) and run with
 * `bun test`. It reuses the setup of opencode's own shell-tool tests (test/tool/shell.test.ts):
 *
 * 1. run the real ShellTool on the command with a context that records every permission
 *    request and stops at the bash request, so the command is never executed;
 * 2. score the recorded patterns with opencode's own `Permission.fromConfig` and
 *    `Permission.evaluate`, the way `Permission.ask` does: any pattern that resolves to deny
 *    blocks the call, any that resolves to ask waits for a person, otherwise it runs.
 *
 * Env: GBB_COMMANDS (path to commands.json), GBB_OUT (directory for the output files).
 */
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import fs from "fs"
import path from "path"
import { Config } from "@/config/config"
import { ShellTool } from "../../src/tool/shell"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { Permission } from "../../src/permission"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Plugin } from "../../src/plugin"
import { testEffect } from "../lib/effect"
import { RuntimeFlags } from "@/effect/runtime-flags"

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(
      LayerNode.group([
        CrossSpawnSpawner.node,
        FSUtil.node,
        Plugin.node,
        Truncate.node,
        Config.node,
        Agent.node,
        RuntimeFlags.node,
      ]),
    ),
    testInstanceStoreLayer,
  ),
)

type Req = Omit<PermissionV1.Request, "id" | "sessionID" | "tool">
class Stop extends Error {}

const BLOCKED = ["rm", "cat", "dd", "curl", "wget", "chmod"]
const ALLOWED = ["echo", "ls", "true", "pwd"]

/** The user's `permission.bash` config for each gate, in the docs' object syntax. */
const CONFIGS = {
  // Run everything except these six. Rules are matched in order, last match wins.
  deny: { bash: { "*": "allow", ...Object.fromEntries(BLOCKED.map((b) => [`${b} *`, "deny"])) } },
  // Only these four run on their own; anything else asks a person.
  allow: { bash: { "*": "ask", ...Object.fromEntries(ALLOWED.map((b) => [`${b} *`, "allow"])) } },
} as const

function verdict(requests: Req[], config: (typeof CONFIGS)[keyof typeof CONFIGS]): "allow" | "ask" | "deny" {
  const ruleset = Permission.fromConfig(config as never)
  let ask = false
  for (const req of requests) {
    for (const pattern of req.patterns) {
      const action = Permission.evaluate(req.permission, pattern, ruleset).action
      if (action === "deny") return "deny"
      if (action !== "allow") ask = true
    }
  }
  return ask ? "ask" : "allow"
}

describe("gate-bypass-bench", () => {
  it.live(
    "records opencode's verdict for every benchmark command",
    () =>
      Effect.gen(function* () {
        const commands: string[] = JSON.parse(fs.readFileSync(process.env.GBB_COMMANDS as string, "utf8"))
        const out = process.env.GBB_OUT as string
        const tmp = yield* tmpdirScoped()
        const patterns: Record<string, Req[]> = {}

        yield* Effect.gen(function* () {
          const tool = yield* (yield* ShellTool).init()
          for (const command of commands) {
            const requests: Req[] = []
            const ctx = {
              sessionID: SessionID.make("ses_gbb"),
              messageID: MessageID.make("msg_gbb"),
              callID: "",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata: () => Effect.void,
              ask: (req: Req) =>
                Effect.sync(() => {
                  requests.push(req)
                  if (req.permission === "bash") throw new Stop()
                }),
            }
            yield* tool.execute({ command, description: "gbb" } as never, ctx as never).pipe(Effect.exit)
            patterns[command] = requests
          }
        }).pipe(provideInstance(tmp))

        const sorted = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)))
        fs.writeFileSync(path.join(out, "patterns.json"), JSON.stringify(sorted(patterns), null, 2) + "\n")
        for (const name of Object.keys(CONFIGS) as (keyof typeof CONFIGS)[]) {
          const v = Object.fromEntries(commands.map((c) => [c, verdict(patterns[c] ?? [], CONFIGS[name])]))
          fs.writeFileSync(path.join(out, `verdicts-${name}.json`), JSON.stringify(sorted(v), null, 2) + "\n")
        }
        expect(Object.keys(patterns).length).toBe(commands.length)
      }),
    120_000,
  )
})
