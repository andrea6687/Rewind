# Rewind

🇬🇧 [English version](README.md)

**Rivedi ogni file che Claude Code ha modificato, una diff alla volta, e rimettilo com'era.**

Mod per Claude Code, nel terminale e nel tab Code di Claude Desktop.

> Ispirato alla mod *Replay Theater* di ClaudeDevs. Questa è un'implementazione indipendente, non ufficiale e non affiliata ad Anthropic, scritta da zero, che aggiunge storico persistente, **ripristino dei file con backup** e un fallback testuale per le app che non disegnano i pulsanti.

Registra ogni **Edit** e **Write** andata a buon fine dentro la cartella del progetto durante un turno, anche le modifiche fatte mentre gira un subagent. Quelle modifiche finiscono nel turno principale, non in un turno a parte. I file fuori dal progetto non vengono registrati. A fine turno salva il turno su disco e mostra un toast per 10 secondi, per esempio `🎭 3 changes recorded · /rewind to review them`. Se il salvataggio fallisce, il toast dice `Rewind: save failed (…)` e resta 15 secondi. `/rewind` apre un pannello che mostra le diff **una alla volta**.

Un file che sembra un segreto viene registrato solo come modificato: niente diff, niente testo precedente e niente backup di quel testo. La regola vale per un tratto di percorso che è `.env`, che inizia con `.env.`, che finisce in `.pem` o `.key`, che inizia con `id_rsa`, o che contiene `secret` o `credentials`. `.envrc` viene registrato per intero.

## Installazione rapida

Serve Claude Code sul computer. Le note in [INSTALL.txt](INSTALL.txt) sono state provate con Claude Code 2.1.289 e 2.1.292. Gli stessi passi in italiano sono in [LEGGIMI-INSTALLAZIONE.txt](LEGGIMI-INSTALLAZIONE.txt).

### Da questa cartella

**Mac e Linux.** Nella cartella estratta, o in un clone di questo repository, esegui:

```bash
./install.sh
```

**Windows.** Doppio clic su [INSTALLA.bat](INSTALLA.bat). Lancia [install.ps1](install.ps1).

Lo script copia la mod in `~/.claude/mods/rewind` (o in `$CLAUDE_CONFIG_DIR/mods/rewind` se quella variabile è impostata; su Windows, `%USERPROFILE%\.claude\mods\rewind`). Se c'è un plugin precedente di nome `replay-theater`, lo rimuove, poi registra questa cartella come marketplace `rewind` e installa `rewind@rewind`. Gli serve il comando `claude`. Se manca, lo script si ferma. Su Windows il messaggio indica https://claude.com/claude-code. Riavvia Claude Code, oppure chiudi del tutto Claude Desktop e riaprilo, poi apri una sessione **nuova**.

Puoi cancellare la cartella da cui hai lanciato lo script. La copia installata è quella sotto `mods/rewind`.

### Da una sessione di Claude Code

```
/plugin install rewind --marketplace andrea6687/rewind
```

Rispondi `y` per aggiungere il marketplace e scegli lo scope **user**. Da quel momento la mod è disponibile in ogni sessione: terminale e tab Code di Claude Desktop. Il manifest del marketplace è [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json).

## Comandi

| Comando | Cosa fa |
| --- | --- |
| `/rewind` | apre l'ultimo turno, sulla prima modifica |
| `/rewind 5` | apre il 5° turno più recente |
| `/rewind storico` | apre lo storico (anche `history` o `h`) |
| `/rewind testo` | solo testo, senza pulsanti (anche `text`). Poi `/rewind next`, `prev`, `restore`, `file`, `yes`, `no`, `up`, `down`, `older`, `newer`, `history`, `close` |
| `/rewind inline` | disegna il visore nella conversazione invece che nel pannello. Si combina: `/rewind 3 inline` |
| `/rewind pannello` | chiede il pannello (anche `pane`) |

Nel composer del terminale, `/rewind` apre il pannello. Se l'app non può piazzare un pannello, lo stesso visore, con gli stessi pulsanti, compare nella risposta di `/rewind`. Un `/rewind` la cui origine non è il composer (il codice tratta così Claude Desktop) risponde in testo, senza pulsanti, a meno che tu aggiunga `pane` o `inline`. Scrivere una parola di azione come `next` o `restore` risponde anch'essa in testo, e sposta il turno già aperto. Il pannello stesso lo dice: se non vedi i pulsanti, usa `/rewind text`.

Le stesse azioni accettano anche `avanti`, `indietro`, `ripristina`, `sì` (e `si`), `conferma`, `annulla`, `su`, `giù`, `chiudi`.

## Tasti nel pannello

| Tasto | Azione |
| --- | --- |
| `p` / `n` | **Prev** / **Next**. Sulla prima modifica di un turno, Prev passa all'ultima modifica del turno precedente, e così via fino al primo turno registrato |
| `c` o `Esc` | **Close** |
| `j` / `k` | scorre una diff lunga |
| `b` / `f` | **Prev turn** / **Next turn** |
| `h` | storico: 10 turni per pagina, `1`…`9` e poi `0` per aprirne uno, `p`/`n` per una pagina più recente o più vecchia, `a` per passare da "this project" a "all projects", `r` per tornare alla diff quando un turno è aperto |

Se questo progetto non ha ancora turni, lo storico passa a tutti i progetti.

## Ripristinare un file

I pulsanti di ripristino stanno sulla stessa riga di Prev, Next e Close.

| Pulsante | Tasto | Cosa fa |
| --- | --- | --- |
| **↩ Restore** | `r` | rimette il file com'era prima di questa singola modifica |
| **↩ File at turn start** | `u` | compare quando lo stesso file è stato modificato più di una volta nel turno: lo riporta a prima della prima di quelle modifiche |
| **↩ Delete created file** | `r` | per un file creato da quella modifica: lo elimina |

Il ripristino chiede sempre prima (**✔ Confirm restore** / `y`, **✖ Cancel** / `x`). In modalità testo lo stesso passo è `/rewind yes` e `/rewind no`. Prima di toccare un file che esiste, salva il contenuto attuale in `~/.claude/replay-theater/backups/` (o `$CLAUDE_CONFIG_DIR/replay-theater/backups/`). Il messaggio di esito include quel percorso, così puoi rimettere il backup a mano. Se il file è cambiato dopo la modifica registrata, anche per modifiche successive nello stesso turno, la domanda lo dice: ripristinando si perdono anche quei cambiamenti.

In modalità testo, `/rewind file` è l'azione "file all'inizio del turno".

## Dove finisce lo storico

`~/.claude/replay-theater/history/` (o `$CLAUDE_CONFIG_DIR/replay-theater/history/`). La cartella tiene il nome `replay-theater` così lo storico già registrato resta visibile. Un file JSON per ogni turno che ha modificato qualcosa, chiamato `<timestamp>_<n modifiche>_<progetto>.json`. `<progetto>` è il nome della cartella più un hash breve del percorso completo, così due cartelle con lo stesso nome restano distinte. I file salvati dalle versioni precedenti, col solo nome della cartella, compaiono ancora per quel progetto.

Storico e backup insieme restano entro 50.000.000 byte (`STORE_CAP`). Oltre quella soglia si cancellano i turni più vecchi, poi i backup più vecchi. Restano l'ultimo turno e l'ultimo backup.

Una singola diff oltre 150.000 caratteri (`ENTRY_CAP`) viene tagliata, e il pannello dice che la diff è stata troncata. Un turno ha un budget di circa 2.000.000 caratteri (`TURN_CAP`), contando le diff e i testi precedenti salvati. La modifica che farebbe superare quel budget, e tutte quelle successive, vengono salvate senza diff e senza testo precedente.

## Privacy

Storico e backup restano in quella cartella sul tuo computer. La mod non li invia da nessuna parte. I file segreti, come descritto sopra, sono salvati senza il loro testo: il file di storico e i backup non lo contengono.

## Limiti

- Ripristina testo UTF-8 fino a 400.000 caratteri (`BEFORE_CAP`). Un file più grande, un file che non si è potuto leggere come testo, una modifica il cui testo precedente è stato scartato perché il turno ha superato il budget, o una modifica registrata da una versione precedente della mod (prima della 0.2.0) che non ha salvato il testo precedente: il pulsante è sostituito dal motivo per cui il ripristino non è disponibile.
- I comandi di shell (`Bash`) non vengono registrati, quindi non si possono ripristinare.
- Un file fuori dalla cartella del progetto non viene registrato. Un `..` che esce dal progetto, e un disco Windows diverso, contano come fuori.

## Sviluppo

Versione 0.5.0, da [.claude-plugin/plugin.json](.claude-plugin/plugin.json) e da `hooks/register.tsx`. Non c'è un `package.json`. I test importano `claude-code/testing`, quindi girano con la CLI di Claude Code:

```
claude plugin validate .
claude plugin test .
```

```
hooks/register.tsx                 registrazione, /rewind, il pannello
hooks/diff.ts                      diff, nomi dello storico, percorsi segreti, tetto dello spazio
hooks/restore.ts                   cosa farebbe un ripristino, e i controlli intorno
hooks/text.ts                      il visore come testo, per le app senza pulsanti
hooks/hooks.json                   elenco dei moduli hook
types/index.d.ts                   le forme salvate su disco
.claude-plugin/plugin.json         manifest del plugin
.claude-plugin/marketplace.json    marketplace locale
install.sh                         installer per Mac e Linux
install.ps1                        installer per Windows, avviato da INSTALLA.bat
tests/rewind.test.ts               test
```

Per contribuire leggi [CONTRIBUTING.md](CONTRIBUTING.md).

## Licenza

[MIT](LICENSE) © Andrea Sportello

---

Se Rewind ti ha evitato di cercare una modifica in un turno, una ⭐ al repository aiuta altre persone a trovarlo. Problemi e idee sono benvenuti nelle [issue](https://github.com/andrea6687/Rewind/issues).
