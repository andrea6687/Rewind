# Security Policy

🇮🇹 Italiano più sotto.

## Reporting a vulnerability

Please **don't open a public issue** for security problems.

Use GitHub's private reporting instead: go to the [Security tab](https://github.com/andrea6687/Rewind/security) and choose **Report a vulnerability**. You'll get an answer as soon as possible, usually within a week.

Examples of what to report:

- a way for the text of a secret file (`.env`, a key, a name containing `secret` or `credentials`, and the other cases in `hooks/diff.ts`) to end up in a history file, a diff, or a backup;
- a way for restore to write or delete a file outside the project, or a file the recorded change did not touch;
- a way for a history file to make restore overwrite something other than the path that was recorded.

## Supported versions

Only the latest version on the `main` branch is supported. The version in this repository is the `version` field of `.claude-plugin/plugin.json` (0.5.0 as of this file).

## What the mod does and doesn't do

- It writes history and backups only under `~/.claude/replay-theater/` (or `$CLAUDE_CONFIG_DIR/replay-theater/`). It does not send them anywhere.
- Secret paths are stored as "modified", without the diff and without the previous text.
- Restore asks before it changes a file, and it saves the current contents to `replay-theater/backups/` first when the file exists.
- The install scripts are [install.sh](install.sh) and [install.ps1](install.ps1) (Windows: [INSTALLA.bat](INSTALLA.bat)). Read them before you run them. They copy this folder to `mods/rewind` inside the Claude config directory, replacing a previous copy of this mod there, and they remove a previous plugin named `replay-theater` if one is installed. They do not ask for administrator rights and they do not modify the Claude Desktop application itself.

---

## Italiano

Per i problemi di sicurezza **non aprire una issue pubblica**: usa la [scheda Security](https://github.com/andrea6687/Rewind/security) → **Report a vulnerability**, che è privata.

È supportata solo l'ultima versione su `main`. La mod scrive storico e backup solo in `~/.claude/replay-theater/` (o in `$CLAUDE_CONFIG_DIR/replay-theater/`) e non li invia da nessuna parte. I percorsi segreti restano senza diff e senza testo precedente. Il ripristino chiede conferma e, se il file esiste, ne salva prima il contenuto in `replay-theater/backups/`. Gli script di installazione sono `install.sh` e `install.ps1`: puoi leggerli prima di eseguirli. Copiano la cartella in `mods/rewind`, sostituiscono una copia precedente di questa mod e rimuovono un plugin precedente di nome `replay-theater`. Non chiedono permessi da amministratore e non modificano l'app Claude Desktop.
