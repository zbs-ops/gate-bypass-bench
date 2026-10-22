//! Ask Codex CLI's own code whether it would run each benchmark command.
//!
//! Mirrors `create_exec_approval_requirement_for_parsed_commands` in codex-rs/core/src/exec_policy.rs
//! (rust-v0.163.0) for a model-issued `bash -lc <script>` call, using the same crate functions:
//!
//! 1. split the script into plain commands with `parse_shell_lc_plain_commands`, or keep the whole
//!    argv if the script isn't plain (that's `commands_for_exec_policy`);
//! 2. match every piece against the user's rules with `resolve_host_executables: true`, so
//!    `/bin/rm` is matched as `rm`;
//! 3. for a piece no rule matches, use core's fallback: the built-in dangerous-command check, then
//!    the approval policy (an unrestricted filesystem, i.e. no OS sandbox).
//!
//! Usage: gbb-harness <rules-file> <never|unless-trusted> <commands.json>
//! Prints a JSON object: command -> "allow" | "prompt" | "forbidden".

use std::collections::BTreeMap;

use codex_execpolicy::{Decision, MatchOptions, PolicyParser};
use codex_shell_command::bash::parse_shell_lc_plain_commands;
use codex_shell_command::is_dangerous_command::{
    DangerousCommandPlatform, dangerous_command_match_for_platform,
};

#[derive(Clone, Copy, PartialEq)]
enum Approval {
    Never,
    UnlessTrusted,
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let [_, rules_path, approval, commands_path] = args.as_slice() else {
        eprintln!("usage: gbb-harness <rules-file> <never|unless-trusted> <commands.json>");
        std::process::exit(2);
    };
    let approval = match approval.as_str() {
        "never" => Approval::Never,
        "unless-trusted" => Approval::UnlessTrusted,
        other => panic!("unknown approval policy {other}"),
    };

    let mut parser = PolicyParser::new();
    let source = std::fs::read_to_string(rules_path).expect("read rules");
    parser.parse(rules_path, &source).expect("parse rules");
    let policy = parser.build();

    let commands: Vec<String> =
        serde_json::from_str(&std::fs::read_to_string(commands_path).expect("read commands"))
            .expect("commands.json is a list of strings");

    // render_decision_for_unmatched_command_for_platform, unrestricted filesystem.
    let fallback = |cmd: &[String]| -> Decision {
        let dangerous = dangerous_command_match_for_platform(cmd, DangerousCommandPlatform::Posix);
        match (dangerous.is_some(), approval) {
            (true, Approval::Never) => Decision::Forbidden,
            (true, Approval::UnlessTrusted) => Decision::Prompt,
            (false, Approval::Never) => Decision::Allow,
            (false, Approval::UnlessTrusted) => Decision::Prompt,
        }
    };
    let options = MatchOptions {
        resolve_host_executables: true,
    };

    let mut verdicts = BTreeMap::new();
    for script in commands {
        let argv = vec!["bash".to_string(), "-lc".to_string(), script.clone()];
        let pieces = parse_shell_lc_plain_commands(&argv)
            .filter(|c| !c.is_empty())
            .unwrap_or_else(|| vec![argv.clone()]);
        let evaluation = policy.check_multiple_with_options(pieces.iter(), &fallback, &options);
        let verdict = match evaluation.decision {
            Decision::Allow => "allow",
            // With approval "never", a prompt is rejected outright (prompt_is_rejected_by_policy).
            Decision::Prompt if approval == Approval::Never => "forbidden",
            Decision::Prompt => "prompt",
            Decision::Forbidden => "forbidden",
        };
        verdicts.insert(script, verdict);
    }
    println!("{}", serde_json::to_string_pretty(&verdicts).expect("serialize"));
}
