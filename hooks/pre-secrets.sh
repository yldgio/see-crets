#!/usr/bin/env bash
# pre-secrets: PreToolUse hook shared between Copilot CLI and Claude Code.
#
# Responsibilities:
#   1. Block direct OS vault CLI calls (security, cmdkey, secret-tool, pass).
#   2. Resolve {{SECRET:key}} placeholders via `see-crets inject`.
#   3. Auto-inject mapped vault keys as env vars for known tools (GITHUB_TOKEN etc).
#   4. Wrap the resolved command with `see-crets scrub-output` so secret values
#      are redacted from tool output before the LLM sees them.
#
# Payload schemas handled:
#   Copilot CLI: {toolName, toolArgs: "<json-string>"}
#   Claude Code: {tool_name, tool_input: {command}}
set -euo pipefail

INPUT="$(cat)"
[ -z "$INPUT" ] && exit 0

# ── Schema detection ──────────────────────────────────────────────────────────
TOOL_NAME="$(printf '%s' "$INPUT" | jq -r '.tool_name // .toolName // empty')"
IS_CLAUDE="$(printf '%s' "$INPUT" | jq 'if .tool_name then true else false end')"

# Only process known shell-invocation tools
case "$TOOL_NAME" in
  Bash|bash|shell|run_terminal_cmd) ;;
  *) exit 0 ;;
esac

# ── Extract command ───────────────────────────────────────────────────────────
if [ "$IS_CLAUDE" = "true" ]; then
  COMMAND="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // .tool_input.input // empty')"
else
  TOOL_ARGS_RAW="$(printf '%s' "$INPUT" | jq -r '.toolArgs // empty')"
  [ -z "$TOOL_ARGS_RAW" ] && exit 0
  TOOL_ARGS="$(printf '%s' "$TOOL_ARGS_RAW" | jq -e . 2>/dev/null)" || exit 0
  COMMAND="$(printf '%s' "$TOOL_ARGS" | jq -r '.command // .bash // .input // .text // empty')"
fi
[ -z "$COMMAND" ] && exit 0

# Normalize whitespace to prevent bypass via tabs, multiple spaces, or backslash-newline continuations
NORM="$(printf '%s' "$COMMAND" | sed -e ':a' -e 'N' -e '$!ba' -e 's/\\\n/ /g' | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ' | sed 's/^ //;s/ $//')"

# ── Deny helpers ──────────────────────────────────────────────────────────────
deny() {
  local reason="$1"
  if [ "$IS_CLAUDE" = "true" ]; then
    jq -cn --arg r "$reason" \
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$r}}'
  else
    jq -cn --arg r "$reason" '{"permissionDecision":"deny","permissionDecisionReason":$r}'
  fi
  exit 0
}

# ── Policy enforcement ────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
POLICY_FILE="$SCRIPT_DIR/tool-guard/policy.json"

if [ -f "$POLICY_FILE" ]; then
  POLICY="$(cat "$POLICY_FILE")"

  while IFS= read -r rule; do
    pattern="$(printf '%s' "$rule" | jq -r '.pattern' | tr '[:upper:]' '[:lower:]')"
    reason="$(printf '%s' "$rule" | jq -r '.reason')"
    mode="$(printf '%s' "$rule" | jq -r '.mode')"
    printf '%s' "$NORM" | grep -qF "$pattern" || continue
    [ "$mode" = "warn" ] && deny "⚠️ Advisory: $reason" || deny "$reason"
  done < <(printf '%s' "$POLICY" | jq -c '.extra_banned_commands[]? // empty')

  while IFS= read -r cat; do
    mode="$(printf '%s' "$cat" | jq -r '.mode')"
    reason="$(printf '%s' "$cat" | jq -r '.reason')"
    while IFS= read -r pattern; do
      printf '%s' "$NORM" | grep -qiF "$pattern" || continue
      [ "$mode" = "warn" ] && deny "⚠️ Advisory: $reason" || deny "$reason"
    done < <(printf '%s' "$cat" | jq -r '.blocked[]? // empty')
  done < <(printf '%s' "$POLICY" | jq -c '.categories | to_entries[] | {mode:.value.mode,reason:.value.reason,blocked:.value.blocked}')
fi

# ── Secret injection ──────────────────────────────────────────────────────────
SEE_CRETS="$(command -v see-crets 2>/dev/null || true)"
[ -z "$SEE_CRETS" ] && exit 0  # binary unavailable — allow passthrough

INJECT_RESULT="$(printf '%s' "$COMMAND" | "$SEE_CRETS" inject 2>/dev/null || true)"
[ -z "$INJECT_RESULT" ] && exit 0

KEYS_COUNT="$(printf '%s' "$INJECT_RESULT" | jq '.keys | length')"
[ "$KEYS_COUNT" = "0" ] && exit 0  # nothing to inject — allow passthrough

MODIFIED_CMD="$(printf '%s' "$INJECT_RESULT" | jq -r '.command')"

# Build env prefix: VAR='value' ... with single-quote escaping for bash -c safety
ENV_PREFIX=""
while IFS= read -r entry; do
  varname="$(printf '%s' "$entry" | jq -r '.key')"
  varval="$(printf '%s' "$entry" | jq -r '.value' | sed "s/'/'\\\\''/g")"
  ENV_PREFIX="${ENV_PREFIX}${varname}='${varval}' "
done < <(printf '%s' "$INJECT_RESULT" | jq -c '.env | to_entries[]')

# Escape single quotes in the modified command for safe embedding in bash -c '...'
ESCAPED_CMD="$(printf '%s' "$MODIFIED_CMD" | sed "s/'/'\\\\''/g")"

# Wrap: env vars scoped to subprocess, run command, pipe output through scrub
# -o pipefail ensures the original command's exit code propagates through the pipe
WRAPPED_CMD="${ENV_PREFIX}bash -o pipefail -c '${ESCAPED_CMD}' 2>&1 | \"${SEE_CRETS}\" scrub-output"

# Return updatedInput (allow with resolved command) — only Claude Code supports updatedInput.
# Copilot CLI silently ignores it and runs the original unresolved command, so we deny instead.
if [ "$IS_CLAUDE" = "true" ]; then
  jq -cn --arg cmd "$WRAPPED_CMD" \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{"command":$cmd}}}'
else
  deny "Secret injection required. Copilot CLI does not support automatic secret injection. Pre-export the required secrets to your environment or use Claude Code for automatic injection."
fi
exit 0
