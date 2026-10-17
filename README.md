# 🎭 Rewind

English · [Italiano](README.it.md)

A mod for Claude Code (the terminal and the Code tab of Claude Desktop).

> Inspired by the *Replay Theater* mod by ClaudeDevs. This is an independent, unofficial implementation, not affiliated with Anthropic, written from scratch, that adds unlimited persistent history, **file restore with backup**, and a text fallback for apps that do not draw the buttons.

- Records every successful **Edit** and **Write** during a turn, including those from subagents.
- At the end of the turn it saves the turn to disk and shows a toast: `🎭 3 changes recorded · /rewind to review them`.
- `/rewind` opens a panel that shows the diffs **one at a time**.

## Commands

| Command | What it does |
| --- | --- |
| `/rewind` | opens the latest turn, first change |
| `/rewind 5` | opens the 5th most recent turn |
| `/rewind history` | opens the history (also `storico` or `h`) |
| `/rewind text` | text-only version, without buttons: `/rewind next`, `prev`, `restore`, `yes`, `no`, `history`, `close` |
| `/rewind inline` | shows the viewer in the conversation instead of the panel (they combine: `/rewind 3 inline`) |

If the app cannot show a panel (for example a version of Claude Desktop that does not support them), the viewer appears on its own in the `/rewind` reply, with the same buttons.

## Keys in the panel

| Key | Action |
| --- | --- |
| `p` / `n` | **Prev** / **Next**: previous or next change. On the first change of a turn, Prev moves to the last change of the previous turn, and so on back to the first recorded turn |
| `c` or `Esc` | **Close** |
| `j` / `k` | scrolls a long diff |
| `b` / `f` | jumps to the previous / next turn |
| `h` | history: 10 turns per page, `1`…`0` to open one, `p`/`n` to change page, `a` to switch from "this project" to "all projects" |

## Restoring a file

The restore buttons are on the same row as Prev/Next/Close:

| Button | Key | What it does |
| --- | --- | --- |
| **↩ Restore** | `r` | puts the file back as it was before this single change |
| **↩ File at turn start** | `u` | shown when the same file was changed more than once in the turn: puts it back to before the first change |
| **↩ Delete created file** | `r` | for files created by that change: deletes them |

Restore always asks for confirmation (**✔ Confirm restore** / `y`, **✖ Cancel** / `x`), and before touching the file it saves the current contents in `~/.claude/rewind/backups/`, so a restore can itself be undone. If the file changed after the change (including later changes) the message says so prominently: restoring also loses those changes.

Limits: it works for UTF-8 text files up to about 400,000 characters; for larger files, for changes recorded with versions earlier than 0.2.0, or in turns with a great many changes, the button is replaced by the reason it is not available. Changes made by shell commands (`Bash`) cannot be restored; the mod does not record them.

## Where the history goes

`~/.claude/replay-theater/history/` (or `$CLAUDE_CONFIG_DIR/replay-theater/history/`; the folder keeps the original name so history already recorded stays visible): one JSON file for every turn that changed something, named `<timestamp>_<n changes>_<project>.json`. No cap on the number: to clean up, delete the old files. A single diff over 150,000 characters is truncated (the panel says so), and so is a turn over ~3 MB.

## Installation

### A) From GitHub (recommended, one line)

Put this folder in a repo, for example `andrea6687/rewind`, then from a Claude Code terminal:

```
/plugin install rewind --marketplace andrea6687/rewind
```

Answer `y` to add the marketplace and choose the **user** scope. From then on the mod works in every session: the terminal and the Code tab of Claude Desktop.

### B) From a local folder

1. Copy the folder to `~/.claude/mods/rewind`.
2. In `~/.claude/settings.json` add:

```json
{
  "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/rewind" }
}
```

3. Restart Claude Code or Claude Desktop. For a quick terminal-only try: `claude --plugin-dir ~/.claude/mods/rewind`.

## Development

```
claude plugin validate .
claude plugin test .
```
