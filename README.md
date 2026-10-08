# 🎭 Rewind

Mod per Claude Code (terminale e tab Code di Claude Desktop).

> Ispirato alla mod *Replay Theater* di ClaudeDevs. Questa è un'implementazione indipendente, non ufficiale e non affiliata ad Anthropic, scritta da zero, che aggiunge storico persistente senza limiti, **ripristino dei file con backup** e un fallback testuale per le app che non disegnano i pulsanti.

- Registra ogni **Edit** e **Write** andata a buon fine durante un turno, anche quelle dei subagent.
- A fine turno salva il turno su disco e mostra un toast: `🎭 3 modifiche registrate · /rewind per rivederle`.
- `/rewind` apre un pannello che mostra le diff **una alla volta**.

## Comandi

| Comando | Cosa fa |
| --- | --- |
| `/rewind` | apre l'ultimo turno, prima modifica |
| `/rewind 5` | apre il 5° turno più recente |
| `/rewind storico` | apre lo storico (anche `history` o `h`) |
| `/rewind text` | versione solo testo, senza pulsanti: `/rewind next`, `prev`, `restore`, `yes`, `no`, `storico`, `close` |
| `/rewind inline` | mostra il visore nella conversazione invece che nel pannello (si combina: `/rewind 3 inline`) |

Se l'app non può mostrare un pannello (per esempio una versione di Claude Desktop che non li supporta), il visore compare da solo nella risposta di `/rewind`, con gli stessi pulsanti.

## Tasti nel pannello

| Tasto | Azione |
| --- | --- |
| `p` / `n` | **Prev** / **Next**: modifica precedente o successiva. Arrivato alla prima modifica di un turno, Prev passa all'ultima del turno prima, e così via fino al primo turno registrato |
| `c` o `Esc` | **Close** |
| `j` / `k` | scorre una diff lunga |
| `b` / `f` | salta al turno precedente / successivo |
| `h` | storico: 10 turni per pagina, `1`…`0` per aprirne uno, `p`/`n` per cambiare pagina, `a` per passare da "questo progetto" a "tutti i progetti" |

## Ripristinare un file

I pulsanti di ripristino stanno nella stessa riga di Prev/Next/Close:

| Pulsante | Tasto | Cosa fa |
| --- | --- | --- |
| **↩ Ripristina** | `r` | rimette il file com'era prima di questa singola modifica |
| **↩ File a inizio turno** | `u` | compare se nel turno lo stesso file è stato modificato più volte: lo riporta a prima della prima modifica |
| **↩ Elimina file creato** | `r` | per i file creati da quella modifica: li elimina |

Il ripristino chiede sempre conferma (**✔ Conferma ripristino** / `y`, **✖ Annulla** / `x`), e prima di toccare il file salva il contenuto attuale in `~/.claude/rewind/backups/`, quindi anche un ripristino si può annullare. Se il file è cambiato dopo la modifica (anche per modifiche successive) il messaggio lo dice in evidenza: ripristinando si perdono anche quei cambiamenti.

Limiti: funziona per file di testo UTF-8 fino a circa 400.000 caratteri; per i file più grandi, per le modifiche registrate con versioni precedenti alla 0.2.0 o in turni con moltissime modifiche il pulsante è sostituito dal motivo per cui non è disponibile. Non si possono ripristinare le modifiche fatte dai comandi shell (`Bash`), che il mod non registra.

## Dove finisce lo storico

`~/.claude/replay-theater/history/` (o `$CLAUDE_CONFIG_DIR/replay-theater/history/`; la cartella conserva il nome originale così lo storico già registrato resta visibile): un file JSON per ogni turno che ha modificato qualcosa, chiamato `<timestamp>_<n modifiche>_<progetto>.json`. Nessun limite di numero: per fare pulizia cancelli i file vecchi. Una singola diff oltre 150.000 caratteri viene troncata (lo dice il pannello), e così anche un turno oltre ~3 MB.

## Installazione

### A) Da GitHub (consigliata, una riga)

Metti questa cartella in un repo, per esempio `andrea6687/rewind`, poi da un terminale Claude Code:

```
/plugin install rewind --marketplace andrea6687/rewind
```

Rispondi `y` per aggiungere il marketplace e scegli lo scope **user**. Da quel momento il mod funziona in ogni sessione: terminale e tab Code di Claude Desktop.

### B) Da cartella locale

1. Copia la cartella in `~/.claude/mods/rewind`.
2. In `~/.claude/settings.json` aggiungi:

```json
{
  "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/rewind" }
}
```

3. Riavvia Claude Code o Claude Desktop. Per una prova veloce solo da terminale: `claude --plugin-dir ~/.claude/mods/rewind`.

## Sviluppo

```
claude plugin validate .
claude plugin test .
```
