#!/usr/bin/env python3
"""Extract tool call patterns from Claude Code transcripts.

Scans the 50 most recently modified JSONL files under ~/.claude/projects/
and tallies: (a) Bash command + first subcommand pairs, (b) MCP tool names.
Prints a frequency-sorted summary as JSON for downstream filtering.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import sys
from collections import Counter
from pathlib import Path

PROJECTS_ROOT = Path.home() / ".claude" / "projects"

# Tokens to skip when finding the actual command at the start of a shell string.
SHELL_PREFIX_NOOPS = {
    "sudo", "timeout", "time", "nice", "ionice", "env", "exec",
    "command", "stdbuf", "unbuffer",
}

# Tokens that terminate a logical command segment (we only care about the first).
SHELL_SEGMENT_BREAKS = {"&&", "||", ";", "|", "|&"}


def leading_command(cmd: str) -> tuple[str, str] | None:
    """Return (binary, first_arg_or_subcommand) from a shell command string.

    Handles env-var prefixes (FOO=bar baz), sudo/timeout-style wrappers,
    backtick/$() substitutions (best-effort), and pipes. Skips past leading
    `cd ... && <real>` and `export ... && <real>` so the "real" command is
    captured instead of cd/export.
    """
    cmd = cmd.strip()
    if not cmd:
        return None

    # Strip leading parenthesis groups like "(cd x && y)" — best-effort.
    cmd = cmd.lstrip("(")

    try:
        tokens = shlex.split(cmd, posix=True, comments=False)
    except ValueError:
        # Unbalanced quotes — fall back to whitespace split.
        tokens = cmd.split()

    i = 0
    while i < len(tokens):
        tok = tokens[i]
        # Env-var prefix: FOO=bar baz
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", tok):
            i += 1
            continue
        # Skip no-op wrappers.
        if tok in SHELL_PREFIX_NOOPS:
            i += 1
            # sudo/timeout sometimes have flags before the real command
            while i < len(tokens) and tokens[i].startswith("-"):
                i += 1
            continue
        # Skip leading "cd <path> && ..." or "export FOO=bar && ..."
        if tok in {"cd", "export", "set"}:
            # Advance to next segment break.
            j = i + 1
            while j < len(tokens) and tokens[j] not in SHELL_SEGMENT_BREAKS:
                j += 1
            # Skip the break token too.
            if j < len(tokens):
                j += 1
            if j < len(tokens):
                i = j
                continue
            # Nothing after cd/export — treat as the command itself.
            break
        break

    if i >= len(tokens):
        return None

    binary = os.path.basename(tokens[i])
    # Strip extensions on Windows-style invocations.
    binary = re.sub(r"\.(exe|cmd|bat|ps1)$", "", binary, flags=re.IGNORECASE)

    subcmd = ""
    # First non-flag arg is the subcommand for tools like git, gh, docker, npm, etc.
    for j in range(i + 1, len(tokens)):
        nxt = tokens[j]
        if nxt in SHELL_SEGMENT_BREAKS:
            break
        if nxt.startswith("-"):
            continue
        subcmd = nxt
        break

    return binary, subcmd


def iter_tool_calls(path: Path):
    """Yield (tool_name, input_dict) for each tool_use entry in a JSONL file."""
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                # The structure: { type: "assistant", message: { content: [ {type, name, input}, ... ] } }
                msg = obj.get("message")
                if not isinstance(msg, dict):
                    continue
                content = msg.get("content")
                if not isinstance(content, list):
                    continue
                for item in content:
                    if not isinstance(item, dict):
                        continue
                    if item.get("type") != "tool_use":
                        continue
                    name = item.get("name")
                    inp = item.get("input")
                    if isinstance(name, str):
                        yield name, inp if isinstance(inp, dict) else {}
    except OSError:
        return


def main() -> int:
    if not PROJECTS_ROOT.exists():
        print(f"Projects root not found: {PROJECTS_ROOT}", file=sys.stderr)
        return 1

    # Gather all jsonl files; sort by mtime desc; cap at 50.
    files = []
    for p in PROJECTS_ROOT.rglob("*.jsonl"):
        try:
            mtime = p.stat().st_mtime
        except OSError:
            continue
        files.append((mtime, p))
    files.sort(key=lambda x: x[0], reverse=True)
    files = files[:50]

    bash_counter: Counter[str] = Counter()
    mcp_counter: Counter[str] = Counter()
    examples: dict[str, str] = {}

    for _, path in files:
        for tool_name, inp in iter_tool_calls(path):
            if tool_name == "Bash":
                cmd = inp.get("command")
                if not isinstance(cmd, str):
                    continue
                parsed = leading_command(cmd)
                if not parsed:
                    continue
                binary, subcmd = parsed
                key = f"{binary} {subcmd}".strip()
                bash_counter[key] += 1
                if key not in examples:
                    examples[key] = cmd[:120]
            elif tool_name.startswith("mcp__"):
                mcp_counter[tool_name] += 1

    result = {
        "files_scanned": len(files),
        "bash": bash_counter.most_common(80),
        "mcp": mcp_counter.most_common(40),
        "examples": examples,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
