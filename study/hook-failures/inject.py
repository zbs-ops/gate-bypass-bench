"""Append codex_hook_failures.rs to the tests module at the end of Codex's pre_tool_use.rs."""

import sys
from pathlib import Path

target = Path(sys.argv[1])
snippet = (Path(__file__).parent / "codex_hook_failures.rs").read_text(encoding="utf-8")
source = target.read_text(encoding="utf-8").rstrip()
if not source.endswith("}") or "mod tests {" not in source:
    sys.exit(f"{target} no longer ends with its tests module; update inject.py")
target.write_text(source[:-1] + "\n" + snippet + "}\n", encoding="utf-8")
print(f"injected the hook-failure study into {target}")
