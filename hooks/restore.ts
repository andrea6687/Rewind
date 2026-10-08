// Putting a file back as it was before a recorded change: what is saved at
// record time, what a restore plans and checks, and the restore itself.
import type { ReplayEntry, ReplayTurn } from '../types'

/** Largest file text kept per change as its "before". */
export const BEFORE_CAP = 400_000

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export type Snapshot = Pick<ReplayEntry, 'before' | 'beforeSkipped'>

export type Inspection = {
  exists: boolean
  currentText: string | undefined
  /** the file differs from what the change left, or cannot be compared */
  isChanged: boolean
  isUnverifiable: boolean
  /** already what the restore would write */
  isAlreadyDone: boolean
}

export type RestorePlan = {
  path: string
  /** the text to put back; null = delete the file the change created */
  before: string | null
  /** SHA-256 the file should have if nothing touched it since */
  expectedHash: string | undefined
  /** how many recorded changes this undoes */
  changes: number
}

const WHY: Record<string, string> = {
  big: 'il file era troppo grande per salvarne la versione precedente',
  unreadable: 'il file non era leggibile come testo',
  budget: 'il turno aveva troppe modifiche per salvare anche le versioni precedenti',
}

/** What a restore of change `index` (or of the whole file in the turn) would do. */
export function planRestore(turn: ReplayTurn, index: number, mode: 'one' | 'file'): { plan: RestorePlan } | { reason: string } {
  const entry = turn.entries[index]
  if (entry === undefined) return { reason: 'modifica non trovata' }
  const same = turn.entries.filter(e => e.path === entry.path)
  const first = mode === 'file' ? same[0] ?? entry : entry
  const last = mode === 'file' ? same[same.length - 1] ?? entry : entry
  if (first.before === undefined) {
    return { reason: first.beforeSkipped ? WHY[first.beforeSkipped] ?? 'versione precedente non salvata' : 'registrata da una versione precedente del mod' }
  }
  return { plan: { path: entry.path, before: first.before, expectedHash: last.afterHash, changes: mode === 'file' ? same.length : 1 } }
}


export const base = (path: string) => path.split(/[\\/]/).pop() ?? path

/** The question put to the person before anything is touched. */
export function describe(plan: RestorePlan, seen: Inspection, mode: 'one' | 'file'): { message: string; isRisky: boolean } {
  const name = base(plan.path)
  const scope = mode === 'file' && plan.changes > 1 ? `a com'era prima delle ${plan.changes} modifiche di questo turno` : "a com'era prima di questa modifica"
  let message = plan.before === null
    ? `Eliminare ${name}, creato da questa modifica?`
    : `Riportare ${name} ${scope}?`
  if (seen.exists) message += ' Il contenuto attuale viene salvato prima in un backup.'
  else if (plan.before !== null) message += ' Il file ora non esiste: lo ricreo.'
  const isRisky = seen.isChanged || seen.isUnverifiable
  if (seen.isChanged && seen.exists) message += ' ATTENZIONE: il file è cambiato dopo questa modifica (anche per modifiche successive): perderai anche quei cambiamenti.'
  else if (seen.isUnverifiable) message += ' Non posso verificare se il file è cambiato da allora.'
  return { message, isRisky }
}

export type RestoreOutcome = { isOk: boolean; text: string }

export const isWindowsPath = (path: string) => /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')

