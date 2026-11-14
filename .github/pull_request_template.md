## What this changes / Cosa cambia

<!-- A short description and, if there is one, the issue it fixes (e.g. Fixes #12). -->

## Tested on / Provato su

- [ ] macOS or Linux (Claude Code version: )
- [ ] Windows (Claude Code version: )
- [ ] Claude Desktop, Code tab (version: )

## Checklist

- [ ] `hooks/register.tsx`, `hooks/diff.ts`, `hooks/restore.ts` and `hooks/text.ts` stay consistent (or the change only applies to one of them)
- [ ] `tests/rewind.test.ts` covers the changed behavior, and `claude plugin test .` was run if the Claude Code CLI is available
- [ ] Secret paths still have no diff, no previous text and no backup of that text
- [ ] `install.sh` and `install.ps1` stay consistent when the install changes, and `bash -n install.sh` passes
- [ ] Both READMEs updated if the behavior changed
