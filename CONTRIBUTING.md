# Contributing

🇮🇹 Italiano più sotto.

Thanks for helping! Bug reports are the most useful contribution: Rewind runs inside Claude Code and Claude Desktop, and every version draws panels a little differently.

## Reporting a bug

Open an [issue](https://github.com/andrea6687/Rewind/issues/new/choose) with the bug template and include:

- your system (macOS, Linux or Windows);
- where you ran it (Claude Code terminal or the Code tab of Claude Desktop) and the Claude Code version;
- how you installed it (`./install.sh`, `INSTALLA.bat`, or `/plugin install`);
- the `/rewind` command you typed, what you expected and what happened.

Before posting, remove anything private. History files under `replay-theater/history/` can contain source code: paste a short excerpt, not the whole file, and never paste a `.env`, a key, or a backup of one.

For a security problem, follow [SECURITY.md](SECURITY.md) and do not open a public issue.

## Suggesting an idea

Open an issue with the idea template and explain the problem you want to solve, not only the solution.

## Sending code

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. Recording, the `/rewind` command and the panel live in `hooks/register.tsx`. Diffs, history file names, secret paths and the store cap live in `hooks/diff.ts`. Restore planning lives in `hooks/restore.ts`. The text viewer lives in `hooks/text.ts`. Keep them in step: a new command needs the panel key, the text command, and the Italian alias next to the others in `hooks/register.tsx`.
3. Add or update a test in `tests/rewind.test.ts` for every behavior you change. The tests import `claude-code/testing`. Run `claude plugin test .` when you have the Claude Code CLI, and say in the pull request what you tested.
4. Interface text is in English. The Italian words (`storico`, `ripristina`, `avanti`, and the others already listed in `hooks/register.tsx`) are command aliases: keep them when you add a command.
5. A path the mod treats as secret must stay without its text: no diff, no previous contents, no backup of that text. Do not weaken that to make a test easier.
6. Installers: a change to `install.sh` (Mac and Linux) usually needs the same change in `install.ps1` (Windows). `INSTALLA.bat` only launches `install.ps1`. Check with `bash -n install.sh`.
7. Update both READMEs (`README.md` and `README.it.md`) if the behavior changes. The short install notes [INSTALL.txt](INSTALL.txt) and [LEGGIMI-INSTALLAZIONE.txt](LEGGIMI-INSTALLAZIONE.txt) should stay in step with the scripts.

## Scope

In scope: recording Edit and Write inside the project, reviewing those diffs, and restoring a file with a backup of what was there.
Out of scope: recording shell commands, saving the contents of secret files, and anything meant to get around Claude's usage limits or account bans.

---

## Italiano

Grazie per l'aiuto! Le segnalazioni di problemi sono il contributo più utile: Rewind gira dentro Claude Code e Claude Desktop, e ogni versione disegna i pannelli in modo un po' diverso.

- **Problema:** apri una [issue](https://github.com/andrea6687/Rewind/issues/new/choose) con il modello "bug" indicando sistema, se usi il terminale o il tab Code, la versione di Claude Code, come hai installato, il comando `/rewind` e cosa è successo. Non incollare file `.env`, chiavi o il loro backup. Per un problema di sicurezza segui [SECURITY.md](SECURITY.md) e non aprire una issue pubblica.
- **Idea:** apri una issue con il modello "idea" e spiega il problema da risolvere.
- **Codice:** per modifiche non piccole apri prima una issue. Tieni allineati `hooks/register.tsx`, `hooks/diff.ts`, `hooks/restore.ts` e `hooks/text.ts`, e aggiorna `tests/rewind.test.ts`. I testi a schermo restano in inglese; le parole italiane sono alias dei comandi. Un file segreto resta senza il suo testo. Se cambi `install.sh`, cambia anche `install.ps1` e controlla con `bash -n install.sh`. Aggiorna entrambi i README se cambia il comportamento.
- **Fuori tema:** registrare i comandi di shell, salvare il contenuto dei file segreti, aggirare i limiti di utilizzo o i blocchi di Claude.
