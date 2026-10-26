    // Injected by gate-bypass-bench's CI into the tests module of
    // codex-rs/hooks/src/events/pre_tool_use.rs. Each case is the result Codex's command runner
    // hands to its PreToolUse parser: exit code, stdout and stderr, or for a timeout the runner's
    // own error ("hook timed out after {n}s", engine/command_runner.rs). Codex hooks can't ask,
    // so the outcome is BLOCKED or RUNS. Writes {case: outcome} to $HOOK_STUDY_OUT.
    #[test]
    fn hook_failure_study() {
        let out = std::env::var("HOOK_STUDY_OUT").expect("set HOOK_STUDY_OUT");
        let deny = r#"{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"blocked by policy"}}"#;
        let cases: Vec<(&str, Option<i32>, String, &str, Option<&str>)> = vec![
            ("deny", Some(0), deny.to_string(), "", None),
            ("ask", Some(0), r#"{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"please confirm"}}"#.to_string(), "", None),
            ("allow", Some(0), r#"{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}"#.to_string(), "", None),
            ("nothing", Some(0), String::new(), "", None),
            ("crash", Some(1), String::new(), "", None),
            ("exit2-reason", Some(2), String::new(), "blocked by policy", None),
            ("exit2-silent", Some(2), String::new(), "", None),
            ("bad-json", Some(0), r#"{"decision": "deny", "#.to_string(), "", None),
            // PreToolUse doesn't support stopReason (a Stop-hook field).
            ("deny-extra-field", Some(0), deny.replacen('{', r#"{"stopReason":"policy","#, 1), "", None),
            ("timeout", None, String::new(), "", Some("hook timed out after 1s")),
        ];
        let mut results = serde_json::Map::new();
        for (id, exit_code, stdout, stderr, error) in cases {
            let mut result = run_result(exit_code, &stdout, stderr);
            result.error = error.map(str::to_string);
            let parsed = parse_completed(&handler(), result, Some("turn-1".to_string()));
            let outcome = if parsed.data.should_block { "BLOCKED" } else { "RUNS" };
            results.insert(id.to_string(), serde_json::Value::String(outcome.to_string()));
        }
        assert_eq!(results["deny"], "BLOCKED", "the control must hold, or the harness is wrong");
        std::fs::write(&out, serde_json::to_string_pretty(&results).unwrap() + "\n").expect("write results");
    }
