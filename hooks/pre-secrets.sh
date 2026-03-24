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

# Normalize whitespace to prevent bypass via tabs, multiple spaces, CRLF, or backslash-newline continuations
NORM="$(printf '%s' "$COMMAND" | tr -d '\r' | sed -e ':a' -e 'N' -e '$!ba' -e 's/\\\n/ /g' | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ' | sed 's/^ //;s/ $//')"

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

# Detect explicit placeholders before injection — drives Copilot CLI deny decision
HAS_PLACEHOLDERS="false"
printf '%s' "$COMMAND" | grep -qF '{{SECRET:' && HAS_PLACEHOLDERS="true"

# Run injection; capture stderr separately so failures surface a clear deny reason.
# Require mktemp: the predictable /tmp/PID fallback is a symlink-attack risk.
INJECT_STDERR_FILE="$(mktemp 2>/dev/null)" || true
if [ -z "$INJECT_STDERR_FILE" ]; then
  # mktemp unavailable — for Copilot CLI with no placeholders, fail open (allow passthrough).
  # For Claude Code or explicit placeholders, we must deny to avoid leaking partial resolution.
  if [ "$IS_CLAUDE" = "false" ] && [ "$HAS_PLACEHOLDERS" = "false" ]; then
    exit 0
  fi
  deny "Secret injection failed: unable to create a secure temporary file (mktemp unavailable)."
fi
if ! INJECT_RESULT="$(printf '%s' "$COMMAND" | "$SEE_CRETS" inject 2>"$INJECT_STDERR_FILE")"; then
  INJECT_ERR_MSG="$(cat "$INJECT_STDERR_FILE" 2>/dev/null || true)"
  rm -f "$INJECT_STDERR_FILE" 2>/dev/null || true
  # For Copilot CLI with no explicit placeholders: fail open rather than blocking unrelated
  # commands when the vault is temporarily unavailable (auto-inject failures are not fatal).
  if [ "$IS_CLAUDE" = "false" ] && [ "$HAS_PLACEHOLDERS" = "false" ]; then
    exit 0
  fi
  [ -z "$INJECT_ERR_MSG" ] && INJECT_ERR_MSG="Secret injection failed: see-crets inject reported an error and placeholders could not be resolved."
  deny "$INJECT_ERR_MSG"
fi
rm -f "$INJECT_STDERR_FILE" 2>/dev/null || true
[ -z "$INJECT_RESULT" ] && exit 0

KEYS_COUNT="$(printf '%s' "$INJECT_RESULT" | jq '.keys | length')"
if [ "$KEYS_COUNT" = "0" ]; then
  # No injection needed. For Claude Code, still wrap with scrub-output so any vault
  # secret values that appear in tool output (e.g. from cat/echo) are redacted before
  # the LLM sees them. Copilot CLI ignores updatedInput, so allow passthrough there.
  if [ "$IS_CLAUDE" = "true" ]; then
    ESCAPED_CMD="$(printf '%s' "$COMMAND" | sed "s/'/'\\\\''/g")"
    WRAPPED_CMD="bash -c '${ESCAPED_CMD}' 2>&1 | \"${SEE_CRETS}\" scrub-output; (exit \${PIPESTATUS[0]})"
    jq -cn --arg cmd "$WRAPPED_CMD" \
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{"command":$cmd}}}'
  fi
  exit 0
fi

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

# Wrap: env vars prefix the bash subprocess; PIPESTATUS captures the original exit code
# before scrub-output (which always exits 0) can mask it.
WRAPPED_CMD="${ENV_PREFIX}bash -c '${ESCAPED_CMD}' 2>&1 | \"${SEE_CRETS}\" scrub-output; (exit \${PIPESTATUS[0]})"

# Return updatedInput (allow with resolved command) — only Claude Code supports updatedInput.
# For Copilot CLI: only deny when the original command had explicit {{SECRET:...}} placeholders.
# If injection was only auto-inject (no placeholders), allow the original to run rather than
# blocking unrelated commands simply because a mapped secret exists in the vault.
if [ "$IS_CLAUDE" = "true" ]; then
  jq -cn --arg cmd "$WRAPPED_CMD" \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{"command":$cmd}}}'
else
  if [ "$HAS_PLACEHOLDERS" = "true" ]; then
    deny "Secret injection required. Copilot CLI does not support automatic secret injection. Pre-export the required secrets to your environment or use Claude Code for automatic injection."
  fi
fi
exit 0
