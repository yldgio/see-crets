$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$rawInput = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($rawInput)) { exit 0 }

$payload = $rawInput | ConvertFrom-Json
# Handle both Bash and PowerShell tool events; ignore all others
if ($payload.tool_name -notin @('Bash', 'PowerShell')) { exit 0 }

# tool_input is already a parsed object — no second parse needed
# Bash events use .command; PowerShell events may use .command or .input
$command = $payload.tool_input?.command
if ([string]::IsNullOrWhiteSpace($command)) {
    $command = $payload.tool_input?.input
}
if ([string]::IsNullOrWhiteSpace($command)) { exit 0 }
# Normalize whitespace (collapse tabs/multiple spaces) to prevent bypass via `rm\t-rf`
$norm = ($command -replace '\s+', ' ').Trim().ToLowerInvariant()

$repoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$policyPath = Join-Path $repoRoot 'hooks\tool-guard\policy.json'
if (-not (Test-Path $policyPath)) { exit 0 }
$policy = Get-Content $policyPath -Raw | ConvertFrom-Json

function Deny([string]$reason) {
    @{
        hookSpecificOutput = @{
            hookEventName            = 'PreToolUse'
            permissionDecision       = 'deny'
            permissionDecisionReason = $reason
        }
    } | ConvertTo-Json -Depth 3 -Compress -EscapeHandling EscapeNonAscii
    exit 0
}

foreach ($rule in $policy.extra_banned_commands) {
    if (-not $norm.Contains(([string]$rule.pattern).ToLowerInvariant())) { continue }
    if ([string]$rule.mode -eq 'warn') { Deny "$([char]0x26A0)$([char]0xFE0F) Advisory: $([string]$rule.reason)" }
    else { Deny ([string]$rule.reason) }
}

foreach ($prop in $policy.categories.PSObject.Properties) {
    $cat    = $prop.Value
    $mode   = [string]$cat.mode
    $reason = [string]$cat.reason
    foreach ($pattern in $cat.blocked) {
        if (-not $norm.Contains($pattern.ToLowerInvariant())) { continue }
        if ($mode -eq 'warn') { Deny "$([char]0x26A0)$([char]0xFE0F) Advisory: $reason" }
        else { Deny $reason }
    }
}

exit 0
