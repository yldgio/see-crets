#Requires -Version 7.1
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

# Detect explicit placeholders before injection — drives Copilot CLI deny decision
$hasPlaceholders = $command -match '\{\{SECRET:'

# Run injection; capture stderr separately so failures surface a clear deny reason
$injectErrFile = [System.IO.Path]::GetTempFileName()
$injectResultRaw = $null
$injectExitCode = 0
try {
    $injectResultRaw = ($command | & $seeCrets inject 2>$injectErrFile)
    $injectExitCode = $LASTEXITCODE
} catch {
    $injectExitCode = 1
}
$injectErrMsg = if (Test-Path $injectErrFile) { (Get-Content $injectErrFile -Raw).Trim() } else { '' }
Remove-Item $injectErrFile -ErrorAction SilentlyContinue

if ($injectExitCode -ne 0) {
    # For Copilot CLI with no explicit placeholders: fail open rather than blocking unrelated
    # commands when the vault is temporarily unavailable (auto-inject failures are not fatal).
    if (-not $isClaude -and -not $hasPlaceholders) { exit 0 }
    $msg = if ([string]::IsNullOrWhiteSpace($injectErrMsg)) {
        "Secret injection failed (exit $injectExitCode): see-crets inject reported an error and placeholders could not be resolved."
    } else {
        "Secret injection failed (exit $injectExitCode): $injectErrMsg"
    }
    Deny $msg
}

if ([string]::IsNullOrWhiteSpace($injectResultRaw)) { exit 0 }
try { $injectResult = $injectResultRaw | ConvertFrom-Json } catch {
    Deny 'Secret injection failed: unable to parse see-crets output as JSON.'
}

if ($injectResult.keys.Count -eq 0) {
    # No injection needed. For Claude Code, still wrap with scrub-output so any vault
    # secret values that appear in tool output (e.g. from cat/echo) are redacted before
    # the LLM sees them. Copilot CLI ignores updatedInput, so allow passthrough there.
    if ($isClaude) {
        $escapedCmd = $command -replace "'", "''"
        $wrappedNoInject = "`$__f = [System.IO.Path]::GetTempFileName(); `$__ec = 1; try { Invoke-Expression '$escapedCmd' 2>&1 | Out-File `$__f -Encoding utf8; `$__ec = `$LASTEXITCODE; Get-Content `$__f -Raw | & '$seeCrets' scrub-output } catch { `$__ec = if (`$LASTEXITCODE -ne 0) { `$LASTEXITCODE } else { 1 } } finally { Remove-Item `$__f -ErrorAction SilentlyContinue }; exit `$__ec"
        @{
            hookSpecificOutput = @{
                hookEventName      = 'PreToolUse'
                permissionDecision = 'allow'
                updatedInput       = @{ command = $wrappedNoInject }
            }
        } | ConvertTo-Json -Depth 4 -Compress -EscapeHandling EscapeNonAscii
    }
    exit 0
}

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

# Wrap: set env vars, use Invoke-Expression for reliable command execution from a string,
# pipe through scrub, and preserve the original command's exit code.
$escapedModCmd = $modifiedCmd -replace "'", "''"
$wrappedCmd = "$envBlock; `$__f = [System.IO.Path]::GetTempFileName(); `$__ec = 1; try { Invoke-Expression '$escapedModCmd' 2>&1 | Out-File `$__f -Encoding utf8; `$__ec = `$LASTEXITCODE; Get-Content `$__f -Raw | & '$seeCrets' scrub-output } catch { `$__ec = if (`$LASTEXITCODE -ne 0) { `$LASTEXITCODE } else { 1 } } finally { Remove-Item `$__f -ErrorAction SilentlyContinue }; exit `$__ec"

# Return updatedInput (allow with resolved command) — only Claude Code supports updatedInput.
# For Copilot CLI: only deny when the original command had explicit {{SECRET:...}} placeholders.
# If injection was only auto-inject (no placeholders), allow the original to run rather than
# blocking unrelated commands simply because a mapped secret exists in the vault.
if ($isClaude) {
    @{
        hookSpecificOutput = @{
            hookEventName      = 'PreToolUse'
            permissionDecision = 'allow'
            updatedInput       = @{ command = $wrappedCmd }
        }
    } | ConvertTo-Json -Depth 4 -Compress -EscapeHandling EscapeNonAscii
} else {
    if ($hasPlaceholders) {
        Deny 'Secret injection required. Copilot CLI does not support automatic secret injection. Pre-export the required secrets to your environment or use Claude Code for automatic injection.'
    }
}
exit 0
