#Requires -Version 5.1
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

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$rawInput = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($rawInput)) { exit 0 }

$payload = $rawInput | ConvertFrom-Json
$isClaude = $null -ne $payload.PSObject.Properties['tool_name']

# Detect tool name (both schemas)
$toolName = if ($isClaude) { [string]$payload.tool_name } else { [string]$payload.toolName }
# Only process known shell-invocation tools
if ($toolName -notin @('Bash', 'bash', 'PowerShell', 'powershell', 'shell', 'run_terminal_cmd')) { exit 0 }

# Extract command
$command = $null
if ($isClaude) {
    $command = [string]($payload.tool_input.command ?? $payload.tool_input.input ?? '')
} else {
    $toolArgsRaw = [string]($payload.toolArgs ?? '')
    if ([string]::IsNullOrWhiteSpace($toolArgsRaw)) { exit 0 }
    try { $toolArgs = $toolArgsRaw | ConvertFrom-Json } catch { exit 0 }
    foreach ($prop in @('command', 'bash', 'powershell', 'input', 'text')) {
        $v = $toolArgs.PSObject.Properties[$prop]
        if ($null -ne $v -and $v.Value -is [string] -and $v.Value.Trim().Length -gt 0) {
            $command = $v.Value; break
        }
    }
}
if ([string]::IsNullOrWhiteSpace($command)) { exit 0 }

# Normalize whitespace to prevent bypass via tabs, multiple spaces, or backslash-newline continuations
$norm = ($command -replace '\\\r?\n', ' ' -replace '\s+', ' ').Trim().ToLowerInvariant()

# Deny helper
function Deny([string]$reason) {
    if ($isClaude) {
        @{
            hookSpecificOutput = @{
                hookEventName            = 'PreToolUse'
                permissionDecision       = 'deny'
                permissionDecisionReason = $reason
            }
        } | ConvertTo-Json -Depth 3 -Compress -EscapeHandling EscapeNonAscii
    } else {
        @{ permissionDecision = 'deny'; permissionDecisionReason = $reason } |
            ConvertTo-Json -Compress -EscapeHandling EscapeNonAscii
    }
    exit 0
}

# Policy enforcement
$policyPath = Join-Path $PSScriptRoot 'tool-guard\policy.json'
if (Test-Path $policyPath) {
    $policy = Get-Content $policyPath -Raw | ConvertFrom-Json
    foreach ($rule in $policy.extra_banned_commands) {
        if (-not $norm.Contains(([string]$rule.pattern).ToLowerInvariant())) { continue }
        if ([string]$rule.mode -eq 'warn') { Deny "$([char]0x26A0)$([char]0xFE0F) Advisory: $([string]$rule.reason)" }
        else { Deny ([string]$rule.reason) }
    }
    foreach ($prop in $policy.categories.PSObject.Properties) {
        $cat = $prop.Value; $mode = [string]$cat.mode; $reason = [string]$cat.reason
        foreach ($pattern in $cat.blocked) {
            if (-not $norm.Contains($pattern.ToLowerInvariant())) { continue }
            if ($mode -eq 'warn') { Deny "$([char]0x26A0)$([char]0xFE0F) Advisory: $reason" }
            else { Deny $reason }
        }
    }
}

# Secret injection
$seeCrets = (Get-Command 'see-crets' -ErrorAction SilentlyContinue)?.Source
if (-not $seeCrets) { exit 0 }

$injectResultRaw = ($command | & $seeCrets inject 2>$null)
if ([string]::IsNullOrWhiteSpace($injectResultRaw)) { exit 0 }
try { $injectResult = $injectResultRaw | ConvertFrom-Json } catch { exit 0 }

if ($injectResult.keys.Count -eq 0) { exit 0 }

$modifiedCmd = [string]$injectResult.command

# Build PowerShell env-assignment block and convert %VAR% cmd-refs to $env:VAR
$envLines = [System.Collections.Generic.List[string]]::new()
foreach ($p in $injectResult.env.PSObject.Properties) {
    $safeVal = ([string]$p.Value) -replace "'", "''"
    $envLines.Add("`$env:$($p.Name) = '$safeVal'")
    # Convert cmd.exe-style %VAR% refs to PowerShell $env:VAR
    $modifiedCmd = $modifiedCmd -replace [regex]::Escape("%$($p.Name)%"), "`$env:$($p.Name)"
}
$envBlock = $envLines -join '; '

# Wrap: capture output, restore original exit code through scrub pipe
$wrappedCmd = "$envBlock; `$__r = ($modifiedCmd 2>&1); `$__ec = `$LASTEXITCODE; `$__r | & '$seeCrets' scrub-output; exit `$__ec"

# Return updatedInput (allow with resolved command) — only Claude Code supports updatedInput.
# Copilot CLI silently ignores it and runs the original unresolved command, so we deny instead.
if ($isClaude) {
    @{
        hookSpecificOutput = @{
            hookEventName      = 'PreToolUse'
            permissionDecision = 'allow'
            updatedInput       = @{ command = $wrappedCmd }
        }
    } | ConvertTo-Json -Depth 4 -Compress -EscapeHandling EscapeNonAscii
} else {
    Deny 'Secret injection required. Copilot CLI does not support automatic secret injection. Pre-export the required secrets to your environment or use Claude Code for automatic injection.'
}
exit 0
