import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ReplayEntry, ReplayTurn, ReplayView } from '../types'
import {
  ENTRY_CAP,
  TURN_CAP,
  capHunks,
  countChanges,
  creationHunks,
  formatWhen,
  hunksToText,
  parseFileName,
  projectSlug,
  rowCount,
  stringHunks,
  turnFileName,
  windowDiff,
} from './diff'
import type { Hunk } from './diff'
import { BEFORE_CAP, base as fileName, describe, isWindowsPath, planRestore, sha256 } from './restore'
import type { Inspection, RestoreOutcome, RestorePlan, Snapshot } from './restore'
import { renderHistory, renderViewer } from './text'

const VERSION = '0.4.0'
const PANE = 'rewind'
const TITLE = 'Rewind'
const PAGE = 10
/** Rows one /rewind up or /rewind down moves a long diff by. */
const TEXT_ROWS_STEP = 30
/** Body rows the pane asks for: controls first, then the diff. */
const PANE_ROWS = 26

const EMPTY_VIEW: ReplayView = {
  mode: 'diff',
  files: [],
  scope: 'project',
  turnPos: 0,
  entry: 0,
  scroll: 0,
  page: 0,
  turn: null,
  error: null,
  inlineSeq: 0,
  closed: false,
  confirm: null,
  notice: null,
}

const pending = atom({ plugin: 'rewind', key: 'pending' } as const, [])
const current = atom({ plugin: 'rewind', key: 'current' } as const, null)
const view = atom({ plugin: 'rewind', key: 'view' } as const, EMPTY_VIEW)

type $ = EngineInterface

/** Where the mod keeps its files: <claude config dir>/rewind. */
async function baseDir($: $): Promise<string> {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  if (config) return `${config.replace(/[\\/]+$/, '')}/replay-theater`
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '.'
  return `${home.replace(/[\\/]+$/, '')}/.claude/replay-theater`
}

/** The turns, one JSON file each. */
async function historyDir($: $): Promise<string> {
  return `${await baseDir($)}/history`
}

/** What a restore overwrote, kept so a restore can itself be undone. */
async function backupDir($: $): Promise<string> {
  return `${await baseDir($)}/backups`
}

/** History file names, newest first, filtered to the project when asked. */
async function listFiles($: $, scope: ReplayView['scope']): Promise<string[]> {
  const dir = await historyDir($)
  const entries = await $.fs.list(dir).catch(() => [])
  const project = projectSlug(await $.session.cwd())
  return entries
    .filter(f => f.kind === 'file')
    .map(f => f.name)
    .filter(name => {
      const meta = parseFileName(name)
      return meta !== null && (scope === 'all' || meta.project === project)
    })
    .sort()
    .reverse()
}

async function loadTurn($: $, name: string): Promise<ReplayTurn> {
  const dir = await historyDir($)
  return JSON.parse(await $.fs.read(`${dir}/${name}`)) as ReplayTurn
}

/** Opens the turn at `pos` of `files` on `entry` (-1 = its last change). */
async function showTurn($: $, base: ReplayView, pos: number, entry: number): Promise<void> {
  const name = base.files[pos]
  if (name === undefined) {
    await update($, view, () => ({ ...base, mode: 'diff' as const, turn: null, error: null, confirm: null, notice: null }))
    return
  }
  try {
    const turn = await loadTurn($, name)
    const last = Math.max(0, turn.entries.length - 1)
    await update($, view, () => ({
      ...base,
      mode: 'diff' as const,
      turnPos: pos,
      entry: entry < 0 ? last : Math.min(entry, last),
      scroll: 0,
      turn,
      error: null,
      confirm: null,
      notice: null,
    }))
  } catch (err) {
    await update($, view, () => ({ ...base, mode: 'diff' as const, turnPos: pos, turn: null, error: `Impossibile leggere ${name}: ${String(err)}`, confirm: null, notice: null }))
  }
}

/** Prev (-1) and Next (+1): change by change, crossing into older or newer turns. */
async function step($: $, dir: -1 | 1): Promise<void> {
  const v = await read($, view)
  if (v.turn === null) return
  const target = v.entry + dir
  if (target >= 0 && target < v.turn.entries.length) {
    await update($, view, now => ({ ...now, entry: target, scroll: 0, confirm: null, notice: null }))
    return
  }
  // files are newest first: an older turn is further down the list
  if (dir < 0 && v.turnPos + 1 < v.files.length) await showTurn($, v, v.turnPos + 1, -1)
  if (dir > 0 && v.turnPos > 0) await showTurn($, v, v.turnPos - 1, 0)
}

async function jumpTurn($: $, dir: -1 | 1): Promise<void> {
  const v = await read($, view)
  const pos = dir < 0 ? v.turnPos + 1 : v.turnPos - 1
  if (pos >= 0 && pos < v.files.length) await showTurn($, v, pos, 0)
}

/** Loads the newest turn, the `back`-th newest, or the history, into the view. */
async function loadView($: $, back: number | 'history'): Promise<{ count: number; what: string }> {
  const before = await read($, view)
  const scope = before.scope
  let files = await listFiles($, scope)
  let used = scope
  // nothing for this project yet: fall back to every project
  if (files.length === 0 && scope === 'project') {
    files = await listFiles($, 'all')
    used = 'all'
  }
  const base: ReplayView = { ...EMPTY_VIEW, files, scope: used, inlineSeq: before.inlineSeq }
  if (back === 'history') {
    await update($, view, () => ({ ...base, mode: 'history' as const, turn: null }))
  } else {
    await showTurn($, base, Math.min(Math.max(0, back - 1), Math.max(0, files.length - 1)), 0)
  }
  const what = files.length === 0
    ? 'nessuna modifica registrata finora'
    : back === 'history' ? `storico, ${files.length} turni` : `${files.length} turni registrati`
  return { count: files.length, what }
}

/** Opens the pane: the newest turn, the `back`-th newest, or the history. */
async function openReplay($: $, back: number | 'history', forceInline: boolean): Promise<string> {
  const loaded = await loadView($, back)
  const seq = (await read($, view)).inlineSeq + 1
  const where = ` Cartella storico: ${await historyDir($)}`
  const hint = ' Se non vedi i pulsanti: /rewind text.'
  let reason = 'richiesto con /rewind inline'
  if (!forceInline) {
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true, rows: PANE_ROWS }).catch(err => ({ isPlaced: false as const, reason: String(err) }))
    if (opened.isPlaced) return `🎭 Rewind aperto nel pannello (${loaded.what}).${where}${hint}`
    reason = opened.reason
    await $.ui.close({ id: PANE }).catch(() => undefined)
  }
  // no pane here: the output row of this run draws the viewer instead
  await update($, view, now => ({ ...now, inlineSeq: seq }))
  return `🎭 Rewind #${seq} (${loaded.what}). Pannello non disponibile qui (${reason}): lo mostro in questa riga.${where}${hint}`
}

/** The viewer as text: open what was asked for, or act on what is open. */
async function textReply($: $, act: string, back: number | 'history', page: number): Promise<string> {
  let v = await read($, view)
  const needsOpen = act === '' || (v.turn === null && v.mode !== 'history')
  if (needsOpen && act !== 'close') {
    await loadView($, back)
    v = await read($, view)
    if (act === '' || v.turn === null) return v.mode === 'history' ? renderHistory(v, page) : renderViewer(v)
  }
  if (act === 'history') {
    await loadView($, 'history')
    return renderHistory(await read($, view), page)
  }
  if (act === 'close') {
    await update($, view, now => ({ ...now, closed: true, confirm: null, notice: null }))
    await $.ui.close({ id: PANE }).catch(() => undefined)
    return '🎭 Rewind chiuso. `/rewind` per riaprirlo.'
  }
  if (act === 'next') await step($, 1)
  else if (act === 'prev') await step($, -1)
  else if (act === 'older') await jumpTurn($, -1)
  else if (act === 'newer') await jumpTurn($, 1)
  else if (act === 'down' || act === 'up') {
    await update($, view, now => {
      const entry = now.turn?.entries[Math.min(now.entry, (now.turn?.entries.length ?? 1) - 1)]
      const max = Math.max(0, rowCount(entry?.diff ?? '') - TEXT_ROWS_STEP)
      const delta = act === 'down' ? TEXT_ROWS_STEP : -TEXT_ROWS_STEP
      return { ...now, scroll: Math.min(max, Math.max(0, now.scroll + delta)), notice: null }
    })
  }
  else if (act === 'restore') await askRestore($, 'one')
  else if (act === 'file') await askRestore($, 'file')
  else if (act === 'yes') {
    const now = await read($, view)
    if (now.confirm === null) await update($, view, cur => ({ ...cur, notice: { isOk: false, text: 'Niente da confermare: prima `/rewind restore`.' } }))
    else await doRestore($, now.confirm.mode)
  } else if (act === 'no') await update($, view, now => ({ ...now, confirm: null, notice: { isOk: true, text: 'Ripristino annullato.' } }))
  v = await read($, view)
  return v.mode === 'history' ? renderHistory(v, page) : renderViewer(v)
}

/** Turns what an Edit or Write answered into a recorded change. */
function toEntry(tool: 'Edit' | 'Write', input: Record<string, unknown>, result: Record<string, unknown>, at: number): ReplayEntry | null {
  if (result.staged === true) return null
  const path = String(result.filePath ?? input.file_path ?? '')
  let hunks = (Array.isArray(result.structuredPatch) ? result.structuredPatch : []) as Hunk[]
  let kind: ReplayEntry['kind'] = 'edit'
  if (tool === 'Write') {
    kind = result.type === 'create' ? 'create' : 'update'
    if (hunks.length === 0 && kind === 'create') hunks = creationHunks(String(result.content ?? input.content ?? ''))
  } else if (hunks.length === 0) {
    hunks = stringHunks(String(result.oldString ?? input.old_string ?? ''), String(result.newString ?? input.new_string ?? ''))
  }
  const { added, removed } = countChanges(hunks)
  const capped = capHunks(hunks, ENTRY_CAP)
  const entry: ReplayEntry = { tool, path, kind, diff: hunksToText(capped.hunks), added, removed, at }
  if (capped.truncated) entry.truncated = true
  return entry
}

/** The file's text before a tool changes it; null when the file is not there. */
async function captureBefore($: $, path: string, tool: 'Edit' | 'Write'): Promise<Snapshot> {
  try {
    if (!(await $.fs.exists(path))) {
      // an Edit never creates a file: a missing one is not something to restore to
      return tool === 'Write' ? { before: null } : { beforeSkipped: 'unreadable' }
    }
    const text = await $.fs.read(path)
    return text.length > BEFORE_CAP ? { beforeSkipped: 'big' } : { before: text }
  } catch {
    return { beforeSkipped: 'unreadable' }
  }
}

async function captureAfterHash($: $, path: string): Promise<string | undefined> {
  try {
    return await sha256(await $.fs.read(path))
  } catch {
    return undefined
  }
}

async function inspect($: $, plan: RestorePlan): Promise<Inspection> {
  const exists = await $.fs.exists(plan.path).catch(() => false)
  let currentText: string | undefined
  if (exists) currentText = await $.fs.read(plan.path).catch(() => undefined)
  const currentHash = currentText === undefined ? undefined : await sha256(currentText)
  const isUnverifiable = plan.expectedHash === undefined || (exists && currentText === undefined)
  const isChanged = !isUnverifiable && (!exists || currentHash !== plan.expectedHash)
  const isAlreadyDone = plan.before === null ? !exists : currentText === plan.before
  return { exists, currentText, isChanged, isUnverifiable, isAlreadyDone }
}

/** Backs the current file up, then writes the old text back or deletes the file. */
async function runRestore($: $, plan: RestorePlan, backupFolder: string): Promise<RestoreOutcome> {
  const seen = await inspect($, plan)
  if (seen.isAlreadyDone) return { isOk: true, text: `Niente da fare: ${fileName(plan.path)} è già ${plan.before === null ? 'assente' : "com'era prima della modifica"}.` }
  let backup = ''
  if (seen.exists) {
    if (seen.currentText === undefined) return { isOk: false, text: 'Non tocco il file: non riesco a salvarne un backup (illeggibile o troppo grande).' }
    try {
      backup = `${backupFolder}/${await $.clock.now()}_${fileName(plan.path).replace(/[^\w.-]+/g, '_')}`
      await $.fs.write(backup, seen.currentText)
    } catch (err) {
      return { isOk: false, text: `Non tocco il file: backup non riuscito (${String(err).slice(0, 120)}).` }
    }
  }
  const saved = backup === '' ? '' : ` Backup di prima del ripristino: ${backup}`
  try {
    if (plan.before === null) {
      const argv = isWindowsPath(plan.path) ? ['cmd', '/d', '/c', 'del', '/f', '/q', plan.path] : ['rm', '-f', '--', plan.path]
      const ran = await $.process.run(argv)
      if (await $.fs.exists(plan.path)) return { isOk: false, text: `Il file è ancora lì (uscita ${ran.exitCode}): ${ran.stderr.trim().slice(0, 150)}.${saved}` }
      return { isOk: true, text: `Eliminato ${plan.path}.${saved}` }
    }
    await $.fs.write(plan.path, plan.before)
    const written = await $.fs.read(plan.path).catch(() => undefined)
    if (written !== plan.before) return { isOk: false, text: `Scrittura non verificata su ${plan.path}.${saved}` }
    return { isOk: true, text: `Ripristinato ${plan.path}.${saved}` }
  } catch (err) {
    return { isOk: false, text: `Ripristino non riuscito (${String(err).slice(0, 150)}).${saved}` }
  }
}

/** Keeps a turn file under what one read takes: later entries give way first. */
function fitTurn(entries: ReplayEntry[]): ReplayEntry[] {
  let used = 0
  return entries.map(entry => {
    used += entry.diff.length + entry.path.length + 200 + (typeof entry.before === 'string' ? entry.before.length : 0)
    if (used <= TURN_CAP) return entry
    const { before: _before, ...rest } = entry
    return { ...rest, diff: '', truncated: true, beforeSkipped: 'budget' as const }
  })
}

/** Asks what a restore would do, and waits for the person's yes. */
async function askRestore($: $, mode: 'one' | 'file'): Promise<void> {
  const v = await read($, view)
  if (v.turn === null) return
  const planned = planRestore(v.turn, v.entry, mode)
  if ('reason' in planned) {
    await update($, view, now => ({ ...now, confirm: null, notice: { isOk: false, text: `Ripristino non disponibile: ${planned.reason}.` } }))
    return
  }
  const seen = await inspect($, planned.plan)
  if (seen.isAlreadyDone) {
    await update($, view, now => ({ ...now, confirm: null, notice: { isOk: true, text: 'Il file è già com\'era prima della modifica: niente da fare.' } }))
    return
  }
  const { message, isRisky } = describe(planned.plan, seen, mode)
  await update($, view, now => ({ ...now, notice: null, confirm: { mode, message, isRisky } }))
}

/** The person said yes: back up, restore, say what happened. */
async function doRestore($: $, mode: 'one' | 'file'): Promise<void> {
  const v = await read($, view)
  if (v.turn === null) return
  const planned = planRestore(v.turn, v.entry, mode)
  if ('reason' in planned) {
    await update($, view, now => ({ ...now, confirm: null, notice: { isOk: false, text: `Ripristino non disponibile: ${planned.reason}.` } }))
    return
  }
  const outcome = await runRestore($, planned.plan, await backupDir($))
  await update($, view, now => ({ ...now, confirm: null, notice: outcome }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rewind',
      description: 'Rivedi le modifiche (Edit/Write) dei turni, una diff alla volta',
      argumentHint: '[n | storico | next | prev | restore | yes | no | text | inline]',
      immediate: true,
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const startedAt = await $.clock.now()
    await update($, current, () => ({ turnId: e.turnId, startedAt, prompt: e.text.slice(0, 200) }))
    await update($, pending, () => [])
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const isWatched = e.tool === 'Edit' || e.tool === 'Write'
    const filePath = isWatched ? String((e as { file_path?: unknown }).file_path ?? '') : ''
    // the file as it stands before the tool touches it: what a restore puts back
    const snapshot = isWatched && filePath !== '' ? await captureBefore($, filePath, e.tool as 'Edit' | 'Write') : undefined
    const ran = await next(e)
    if (e.tool !== 'Edit' && e.tool !== 'Write') return ran
    if (ran.deny !== undefined || ran.isError === true || ran.result === undefined) return ran
    try {
      const entry = toEntry(e.tool, e as unknown as Record<string, unknown>, ran.result as Record<string, unknown>, await $.clock.now())
      if (entry !== null) {
        if (snapshot?.before !== undefined) entry.before = snapshot.before
        else if (snapshot?.beforeSkipped !== undefined) entry.beforeSkipped = snapshot.beforeSkipped
        const hash = await captureAfterHash($, entry.path)
        if (hash !== undefined) entry.afterHash = hash
        await update($, pending, list => [...list, entry])
      }
    } catch {
      // recording never gets in the way of the edit itself
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    const entries = await read($, pending)
    const turn = await read($, current)
    await update($, pending, () => [])
    await update($, current, () => null)
    if (entries.length === 0) return done
    try {
      const cwd = await $.session.cwd()
      const project = projectSlug(cwd)
      const startedAt = turn?.startedAt ?? entries[0]?.at ?? (await $.clock.now())
      const record: ReplayTurn = {
        turnId: turn?.turnId ?? e.turnId,
        startedAt,
        endedAt: await $.clock.now(),
        prompt: turn?.prompt ?? '',
        cwd,
        project,
        entries: fitTurn(entries),
      }
      const dir = await historyDir($)
      await $.fs.write(`${dir}/${turnFileName(startedAt, entries.length, project)}`, JSON.stringify(record))
      const n = entries.length
      $.ui.toast(`🎭 ${n} ${n === 1 ? 'modifica registrata' : 'modifiche registrate'} · /rewind per rivederle`)
    } catch (err) {
      $.ui.toast(`Rewind: salvataggio non riuscito (${String(err).slice(0, 120)})`)
    }
    return done
  })

  on('command.run', { command: 'rewind' }, async ($, e) => {
    const words = e.args.trim().toLowerCase().split(/\s+/).filter(w => w !== '')
    const ACTIONS: Record<string, string> = {
      next: 'next', n: 'next', avanti: 'next', prev: 'prev', p: 'prev', indietro: 'prev',
      restore: 'restore', r: 'restore', ripristina: 'restore', file: 'file', u: 'file',
      yes: 'yes', y: 'yes', si: 'yes', 'sì': 'yes', conferma: 'yes', no: 'no', x: 'no', annulla: 'no',
      up: 'up', k: 'up', su: 'up', down: 'down', j: 'down', 'giù': 'down', giu: 'down',
      older: 'older', b: 'older', newer: 'newer', f: 'newer', close: 'close', c: 'close', chiudi: 'close',
    }
    const act = words.map(w => ACTIONS[w]).find(a => a !== undefined) ?? ''
    const isHistory = words.some(w => w === 'storico' || w === 'history' || w === 'h')
    const number = words.map(w => Number.parseInt(w, 10)).find(n => Number.isFinite(n) && n > 0)
    const wantsPane = words.some(w => w === 'pane' || w === 'pannello')
    const wantsInline = words.includes('inline')
    // a typed command in a terminal gets the visual viewer; anything else (Desktop) gets text
    const wantsText = words.some(w => w === 'text' || w === 'testo') || act !== '' || (!wantsPane && !wantsInline && e.origin.kind !== 'composer')
    if (wantsText) {
      const text = await textReply($, isHistory && act === '' ? 'history' : act, isHistory ? 'history' : number ?? 1, isHistory ? number ?? 1 : 1)
      return { text: `${text}\n\n_(modo testo · origine: ${e.origin.kind})_` }
    }
    if (isHistory) return { text: await openReplay($, 'history', wantsInline) }
    return { text: await openReplay($, number ?? 1, wantsInline) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    try {
      return await drawViewer($, e, await read($, view))
    } catch (err) {
      return <Text color="error">Rewind: errore nel disegno ({String(err).slice(0, 300)})</Text>
    }
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'rewind' } }, async ($, e, next) => {
    const seq = Number(/Rewind #(\d+)/.exec(e.props.text)?.[1] ?? 0)
    const v = await read($, view)
    if (seq === 0 || seq !== v.inlineSeq) return next(e)
    const { Text } = $.ui.resolve(e)
    if (v.closed) return <Text dimColor>🎭 Rewind chiuso · /rewind per riaprirlo</Text>
    try {
      return await drawViewer($, e, v)
    } catch (err) {
      return <Text color="error">Rewind: errore nel disegno ({String(err).slice(0, 300)})</Text>
    }
  })
}

/** The viewer itself, drawn into the pane or into /rewind's output row. */
async function drawViewer($: $, e: any, v: ReplayView) {
    const { Box, Text, Button, Code } = $.ui.resolve(e) as any
    const rows = e.viewport?.rows ?? 40
    const close = async () => {
      await update($, view, now => ({ ...now, closed: true }))
      await $.ui.close({ id: PANE }).catch(() => undefined)
    }
    const total = v.files.length
    const scopeLabel = v.scope === 'project' ? 'questo progetto' : 'tutti i progetti'

    if (v.mode === 'history') {
      const pages = Math.max(1, Math.ceil(total / PAGE))
      const page = Math.min(v.page, pages - 1)
      const slice = v.files.slice(page * PAGE, page * PAGE + PAGE)
      const toggleScope = async () => {
        const scope: ReplayView['scope'] = v.scope === 'project' ? 'all' : 'project'
        const files = await listFiles($, scope)
        await update($, view, now => ({ ...now, scope, files, page: 0, turnPos: 0 }))
      }
      return (
        <Box flexDirection="column">
          <Text bold>🎭 Storico · {scopeLabel}</Text>
          <Text dimColor>
            {total} {total === 1 ? 'turno' : 'turni'} · pagina {page + 1}/{pages} · premi il numero per aprire
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {slice.length === 0 && <Text dimColor>Nessun turno registrato qui.</Text>}
            {slice.map((name, i) => {
              const meta = parseFileName(name)
              const pos = page * PAGE + i
              const label = meta
                ? `${formatWhen(meta.startedAt)} · ${meta.project} · ${meta.count} ${meta.count === 1 ? 'modifica' : 'modifiche'}`
                : name
              return (
                <Button
                  key={`turn-${pos}`}
                  plain
                  hotkey={String((i + 1) % 10)}
                  label={label}
                  dimColor={pos !== v.turnPos}
                  onPress={() => showTurn($, v, pos, 0)}
                />
              )
            })}
          </Box>
          <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
            <Button key="newer" hotkey="p" label="◀ Più recenti" dimColor={page === 0} onPress={() => update($, view, now => ({ ...now, page: Math.max(0, page - 1) }))} />
            <Button key="older" hotkey="n" label="Più vecchi ▶" dimColor={page >= pages - 1} onPress={() => update($, view, now => ({ ...now, page: Math.min(pages - 1, page + 1) }))} />
            <Button key="scope" hotkey="a" label={v.scope === 'project' ? 'Tutti i progetti' : 'Solo questo progetto'} onPress={toggleScope} />
            {v.turn !== null && <Button key="back" hotkey="r" label="Torna alla diff" onPress={() => update($, view, now => ({ ...now, mode: 'diff' as const }))} />}
            <Button key="close" hotkey="c" role="dismiss" label="Close" onPress={close} />
          </Box>
        </Box>
      )
    }

    const toHistory = () => update($, view, now => ({ ...now, mode: 'history' as const, page: Math.floor(now.turnPos / PAGE), confirm: null, notice: null }))

    if (v.turn === null || v.turn.entries.length === 0) {
      return (
        <Box flexDirection="column">
          <Text bold>🎭 Rewind</Text>
          <Text dimColor>{v.error ?? 'Nessuna modifica registrata finora. Le Edit/Write di ogni turno compaiono qui a fine turno.'}</Text>
          <Box flexDirection="row" gap={1} marginTop={1}>
            {total > 0 && <Button key="history" hotkey="h" label="Storico" onPress={toHistory} />}
            <Button key="close" hotkey="c" role="dismiss" label="Close" onPress={close} />
          </Box>
        </Box>
      )
    }

    const turn = v.turn
    const entry = turn.entries[Math.min(v.entry, turn.entries.length - 1)] as ReplayEntry
    const room = Math.max(5, Math.min(rows, PANE_ROWS) - 12)
    const lines = rowCount(entry.diff)
    const scroll = Math.min(v.scroll, Math.max(0, lines - room))
    const source = windowDiff(entry.diff, scroll, room)
    const hasPrev = v.entry > 0 || v.turnPos + 1 < total
    const hasNext = v.entry < turn.entries.length - 1 || v.turnPos > 0
    const planOne = planRestore(turn, Math.min(v.entry, turn.entries.length - 1), 'one')
    const planFile = planRestore(turn, Math.min(v.entry, turn.entries.length - 1), 'file')
    const sameFile = turn.entries.filter(x => x.path === entry.path).length
    const kindLabel = entry.kind === 'create' ? 'nuovo file' : entry.kind === 'update' ? 'riscritto' : 'modificato'
    const scrollBy = (delta: number) =>
      update($, view, now => ({ ...now, scroll: Math.min(Math.max(0, lines - room), Math.max(0, scroll + delta)) }))

    return (
      <Box flexDirection="column">
        <Text bold>
          🎭 v{VERSION} · Turno {total - v.turnPos}/{total} · {formatWhen(turn.startedAt)} · {turn.project}
        </Text>
        {turn.prompt !== '' && (
          <Text dimColor italic wrap="truncate-end">
            «{turn.prompt.replace(/\s+/g, ' ')}»
          </Text>
        )}
        <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
          <Button key="prev" hotkey="p" variant="primary" label="◀ Prev" dimColor={!hasPrev} onPress={() => step($, -1)} />
          <Button key="next" hotkey="n" variant="primary" label="Next ▶" dimColor={!hasNext} onPress={() => step($, 1)} />
          <Button key="close" hotkey="c" role="dismiss" label="Close" onPress={close} />
          {v.confirm !== null ? (
            <Button key="confirm" hotkey="y" variant="primary" label="✔ Conferma ripristino" onPress={() => doRestore($, v.confirm?.mode ?? 'one')} />
          ) : (
            'plan' in planOne && (
              <Button key="restore" hotkey="r" label={planOne.plan.before === null ? '↩ Elimina file creato' : '↩ Ripristina'} onPress={() => askRestore($, 'one')} />
            )
          )}
          {v.confirm !== null ? (
            <Button key="cancel" hotkey="x" label="✖ Annulla" onPress={() => update($, view, now => ({ ...now, confirm: null }))} />
          ) : (
            sameFile > 1 && 'plan' in planFile && (
              <Button key="restore-file" hotkey="u" label="↩ File a inizio turno" onPress={() => askRestore($, 'file')} />
            )
          )}
          <Button key="older-turn" hotkey="b" label="⏮ Turno prec." dimColor={v.turnPos + 1 >= total} onPress={() => jumpTurn($, -1)} />
          <Button key="newer-turn" hotkey="f" label="Turno succ. ⏭" dimColor={v.turnPos === 0} onPress={() => jumpTurn($, 1)} />
          <Button key="history" hotkey="h" label="Storico" onPress={toHistory} />
          {lines > room && <Button key="up" hotkey="k" label="↑" onPress={() => scrollBy(-Math.ceil(room / 2))} />}
          {lines > room && <Button key="down" hotkey="j" label="↓" onPress={() => scrollBy(Math.ceil(room / 2))} />}
        </Box>
        {v.confirm !== null && <Text color={v.confirm.isRisky ? 'warning' : undefined}>{v.confirm.message}</Text>}
        {v.confirm === null && !('plan' in planOne) && <Text dimColor>↩ Ripristino non disponibile: {planOne.reason}</Text>}
        {v.notice !== null && (
          <Text color={v.notice.isOk ? 'success' : 'error'}>{v.notice.isOk ? '✔ ' : '✖ '}{v.notice.text}</Text>
        )}
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Text bold color="claude">
            {v.entry + 1}/{turn.entries.length}
          </Text>
          <Text dimColor>{entry.tool} · {kindLabel}</Text>
          <Text color="success">+{entry.added}</Text>
          <Text color="error">−{entry.removed}</Text>
        </Box>
        <Text wrap="truncate-start">{entry.path}</Text>
        <Box flexDirection="column">
          {source === '' ? (
            <Text dimColor>(nessuna differenza da mostrare: file vuoto o invariato)</Text>
          ) : (
            <Code key="diff" source={source} format="diff" path={entry.path} />
          )}
          {entry.truncated === true && <Text dimColor>… diff troncata nello storico perché troppo grande</Text>}
          {lines > room && (
            <Text dimColor>
              righe {scroll + 1}–{Math.min(lines, scroll + room)} di {lines} · j/k per scorrere
            </Text>
          )}
        </Box>
      </Box>
    )
}
