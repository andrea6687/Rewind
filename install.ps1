# Installa Rewind per Claude Code (Windows). Si avvia con INSTALLA.bat.
$ErrorActionPreference = 'Continue'
$src = $PSScriptRoot
Write-Host ''
Write-Host '=== Installazione di Rewind ===' -ForegroundColor Cyan

$claude = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claude) {
  Write-Host ''
  Write-Host 'Non trovo il comando "claude". Installa prima Claude Code (https://claude.com/claude-code) e riapri questo programma.' -ForegroundColor Red
  Read-Host 'Premi Invio per chiudere'
  exit 1
}

# crea la cartella .claude\mods (se non esiste) e ci copia la mod
if ($env:CLAUDE_CONFIG_DIR) { $base = $env:CLAUDE_CONFIG_DIR } else { $base = Join-Path $env:USERPROFILE '.claude' }
$mods = Join-Path $base 'mods'
$dir = Join-Path $mods 'rewind'
if (-not (Test-Path $mods)) { New-Item -ItemType Directory -Path $mods -Force | Out-Null; Write-Host "Creata la cartella: $mods" }
if ((Resolve-Path $src).Path -ne (Resolve-Path -ErrorAction SilentlyContinue $dir).Path) {
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  Copy-Item -Path (Join-Path $src '*') -Destination $dir -Recurse -Force
}
Write-Host "Mod copiata in: $dir"

# elimina eventuali copie della vecchia versione (nome originale), senza errori se non ci sono
& claude plugin uninstall replay-theater@replay-theater 2>$null | Out-Null
& claude plugin marketplace remove replay-theater 2>$null | Out-Null

Write-Host 'Aggiungo la mod...'
& claude plugin marketplace add "$dir"
if ($LASTEXITCODE -ne 0) { & claude plugin marketplace update rewind }

Write-Host 'Installo...'
& claude plugin install rewind@rewind
if ($LASTEXITCODE -ne 0) { & claude plugin update rewind@rewind }

Write-Host ''
& claude plugin list
Write-Host ''
Write-Host 'Fatto. Ora:' -ForegroundColor Green
Write-Host ' 1. Se usi Claude Desktop: chiudilo del tutto (icona nella barra -> Esci) e riaprilo.'
Write-Host ' 2. Apri una NUOVA sessione Code, fai fare a Claude una modifica a un file e scrivi /rewind.'
Write-Host " Ora puoi cancellare la cartella da cui hai avviato l'installazione: la mod e' in $dir."
Write-Host ''
Read-Host 'Premi Invio per chiudere'
