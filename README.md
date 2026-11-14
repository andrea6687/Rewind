# Rewind

🇮🇹 [Versione italiana](README.it.md)

**Review every file Claude Code changed, one diff at a time, and put it back.**

A mod for Claude Code, in the terminal and in the Code tab of Claude Desktop.

> Inspired by the *Replay Theater* mod by ClaudeDevs. This is an independent, unofficial implementation, not affiliated with Anthropic, written from scratch, that adds persistent history, **file restore with backup**, and a text fallback for apps that do not draw the buttons.

It records every successful **Edit** and **Write** inside the project folder during a turn, including edits made while a subagent is running. Those edits are saved on the main turn, not as a turn of their own. Files outside the project are skipped. At the end of the turn it writes the turn to disk and shows a toast for 10 seconds, for example `🎭 3 changes recorded · /rewind to review them`. If the save fails, the toast says `Rewind: save failed (…)` and stays for 15 seconds. `/rewind` opens a panel that shows the diffs **one at a time**.

A file that looks like a secret is recorded only as modified: no diff, no previous text, and no backup of that text. The rule matches a path segment that is `.env`, that starts with `.env.`, that ends in `.pem` or `.key`, that starts with `id_rsa`, or that contains `secret` or `credentials`. `.envrc` is recorded in full.

## Quick install

You need Claude Code on the computer. The notes in [INSTALL.txt](INSTALL.txt) were tried with Claude Code 2.1.289 and 2.1.292. The same steps in Italian are in [LEGGIMI-INSTALLAZIONE.txt](LEGGIMI-INSTALLAZIONE.txt).

### From this folder

**Mac and Linux.** In the extracted folder, or in a clone of this repository, run:

```bash
./install.sh
```

**Windows.** Double-click [INSTALLA.bat](INSTALLA.bat). It runs [install.ps1](install.ps1).

The script copies the mod to `~/.claude/mods/rewind` (or `$CLAUDE_CONFIG_DIR/mods/rewind` when that variable is set; on Windows, `%USERPROFILE%\.claude\mods\rewind`). It removes a previous plugin named `replay-theater`, if one is installed, then registers this folder as the `rewind` marketplace and installs `rewind@rewind`. It needs the `claude` command. When that command is missing, the script stops. On Windows the message points to https://claude.com/claude-code. Restart Claude Code, or quit Claude Desktop completely and open it again, then open a **new** session.

You can delete the folder you launched the script from. The installed copy is the one under `mods/rewind`.

### From a Claude Code session

```
/plugin install rewind --marketplace andrea6687/rewind
```

Answer `y` to add the marketplace and choose the **user** scope. From then on the mod is available in every session: the terminal and the Code tab of Claude Desktop. The marketplace manifest is [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json).

## Commands

| Command | What it does |
| --- | --- |
| `/rewind` | opens the latest turn, on its first change |
| `/rewind 5` | opens the 5th most recent turn |
| `/rewind history` | opens the history (`storico` and `h` do the same) |
| `/rewind text` | text only, without buttons (`testo` too). Then `/rewind next`, `prev`, `restore`, `file`, `yes`, `no`, `up`, `down`, `older`, `newer`, `history`, `close` |
| `/rewind inline` | draws the viewer in the conversation instead of the panel. It combines: `/rewind 3 inline` |
| `/rewind pane` | asks for the panel (`pannello` too) |

In the terminal composer, `/rewind` opens the panel. If the app cannot place a panel, the same viewer, with the same buttons, is drawn in the `/rewind` reply. A `/rewind` whose origin is not the composer (the code treats Claude Desktop this way) answers in text, without buttons, unless you add `pane` or `inline`. Typing an action word such as `next` or `restore` also answers in text, and moves the turn that is already open. The panel itself says: if you do not see the buttons, use `/rewind text`.

The same actions accept the Italian words `avanti`, `indietro`, `ripristina`, `sì` (and `si`), `conferma`, `annulla`, `su`, `giù`, `chiudi`.

## Keys in the panel

| Key | Action |
| --- | --- |
| `p` / `n` | **Prev** / **Next**. On the first change of a turn, Prev moves to the last change of the previous turn, and so on back to the first recorded turn |
| `c` or `Esc` | **Close** |
| `j` / `k` | scrolls a long diff |
| `b` / `f` | **Prev turn** / **Next turn** |
| `h` | history: 10 turns per page, `1`…`9` then `0` to open one, `p`/`n` for a newer or older page, `a` to switch between "this project" and "all projects", `r` to go back to the diff when a turn is open |

If this project has no turns yet, the history falls back to all projects.

## Restoring a file

The restore buttons sit on the same row as Prev, Next and Close.

| Button | Key | What it does |
| --- | --- | --- |
| **↩ Restore** | `r` | puts the file back as it was before this single change |
| **↩ File at turn start** | `u` | shown when the same file was changed more than once in the turn: puts it back to before the first of those changes |
| **↩ Delete created file** | `r` | for a file created by that change: deletes it |

Restore always asks first (**✔ Confirm restore** / `y`, **✖ Cancel** / `x`). In text mode the same step is `/rewind yes` and `/rewind no`. Before it touches a file that exists, it saves the current contents under `~/.claude/replay-theater/backups/` (or `$CLAUDE_CONFIG_DIR/replay-theater/backups/`). The result message includes that path, so you can put the backup back yourself. If the file changed after the recorded change, including later changes in the same turn, the question says so: restoring also drops those changes.

In text mode, `/rewind file` is the "file at turn start" action.

## Where the history goes

`~/.claude/replay-theater/history/` (or `$CLAUDE_CONFIG_DIR/replay-theater/history/`). The folder keeps the name `replay-theater` so history already recorded stays visible. One JSON file for every turn that changed something, named `<timestamp>_<n changes>_<project>.json`. `<project>` is the folder name plus a short hash of the full path, so two folders with the same name stay apart. Files saved by older versions, with the folder name alone, still show up for that project.

History and backups together stay within 50,000,000 bytes (`STORE_CAP`). Past that, the oldest turns are deleted, then the oldest backups. The newest turn and the newest backup are kept.

A single diff over 150,000 characters (`ENTRY_CAP`) is cut, and the panel says the diff was truncated. A turn has a budget of about 2,000,000 characters (`TURN_CAP`), counting diffs and saved previous texts. The change that would push the turn past that budget, and every change after it, are stored without the diff and without the previous text.

## Privacy

History and backups stay in that folder on your computer. The mod does not send them anywhere. Secret files, as described above, are stored without their text: the history file and the backups do not contain it.

## Limitations

- It restores UTF-8 text up to 400,000 characters (`BEFORE_CAP`). A larger file, a file that could not be read as text, a change whose previous text was dropped because the turn was over budget, or a change recorded by an earlier version of the mod (before 0.2.0) that did not save the previous text: the button is replaced by the reason restore is unavailable.
- Shell commands (`Bash`) are not recorded, so they cannot be restored.
- A file outside the project folder is not recorded. `..` that leaves the project, and a different Windows drive, count as outside.

## Development

Version 0.5.0, from [.claude-plugin/plugin.json](.claude-plugin/plugin.json) and `hooks/register.tsx`. There is no `package.json`. The tests import `claude-code/testing`, so they run with the Claude Code CLI:

```
claude plugin validate .
claude plugin test .
```

```
hooks/register.tsx                 recording, /rewind, the panel
hooks/diff.ts                      diffs, history names, secret paths, the store cap
hooks/restore.ts                   what a restore would do, and the checks around it
hooks/text.ts                      the viewer as text, for apps without buttons
hooks/hooks.json                   hook module list
types/index.d.ts                   the shapes stored on disk
.claude-plugin/plugin.json         plugin manifest
.claude-plugin/marketplace.json    local marketplace
install.sh                         Mac and Linux installer
install.ps1                        Windows installer, started by INSTALLA.bat
tests/rewind.test.ts               tests
```

To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Andrea Sportello

---

If Rewind saved you from hunting through a turn, a ⭐ on the repository helps other people find it. Bugs and ideas are welcome in the [issues](https://github.com/andrea6687/Rewind/issues).
