# Install Rewind for Claude Code (Windows). Launched by INSTALLA.bat.
$ErrorActionPreference = 'Continue'
$src = $PSScriptRoot
Write-Host ''
Write-Host '=== Installing Rewind ===' -ForegroundColor Cyan

$claude = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claude) {
  Write-Host ''
  Write-Host 'Could not find the "claude" command. Install Claude Code first (https://claude.com/claude-code) and open this program again.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

# create the .claude\mods folder (if it does not exist) and copy the mod into it
if ($env:CLAUDE_CONFIG_DIR) { $base = $env:CLAUDE_CONFIG_DIR } else { $base = Join-Path $env:USERPROFILE '.claude' }
$mods = Join-Path $base 'mods'
$dir = Join-Path $mods 'rewind'
if (-not (Test-Path $mods)) { New-Item -ItemType Directory -Path $mods -Force | Out-Null; Write-Host "Created folder: $mods" }
if ((Resolve-Path $src).Path -ne (Resolve-Path -ErrorAction SilentlyContinue $dir).Path) {
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  Copy-Item -Path (Join-Path $src '*') -Destination $dir -Recurse -Force
}
Write-Host "Mod copied to: $dir"

# remove any copies of the old version (original name), without errors if they are absent
& claude plugin uninstall replay-theater@replay-theater 2>$null | Out-Null
& claude plugin marketplace remove replay-theater 2>$null | Out-Null

Write-Host 'Adding the mod...'
& claude plugin marketplace add "$dir"
if ($LASTEXITCODE -ne 0) { & claude plugin marketplace update rewind }

Write-Host 'Installing...'
& claude plugin install rewind@rewind
if ($LASTEXITCODE -ne 0) { & claude plugin update rewind@rewind }

Write-Host ''
& claude plugin list
Write-Host ''
Write-Host 'Done. Next:' -ForegroundColor Green
Write-Host ' 1. If you use Claude Desktop: quit it completely (tray icon -> Quit) and open it again.'
Write-Host ' 2. Open a NEW Code session, have Claude change a file, and type /rewind.'
Write-Host " You can now delete the folder you started the installation from: the mod is in $dir."
Write-Host ''
Read-Host 'Press Enter to close'
