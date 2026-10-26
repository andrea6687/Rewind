// Putting a file back as it was before a recorded change: what is saved at
// record time, what a restore plans and checks, and the restore itself.
import type { ReplayEntry, ReplayTurn } from '../types'
import { isInsideProject, isSecretPath } from './diff'

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
  big: 'the file was too large to save its previous version',
  unreadable: 'the file was not readable as text',
  budget: 'the turn had too many changes to also save the previous versions',
  secret: 'the file looks like it holds a secret, so its text was not saved',
}

/** What a restore of change `index` (or of the whole file in the turn) would do. */
export function planRestore(turn: ReplayTurn, index: number, mode: 'one' | 'file'): { plan: RestorePlan } | { reason: string } {
  const entry = turn.entries[index]
  if (entry === undefined) return { reason: 'change not found' }
  if (turn.cwd && !isInsideProject(entry.path, turn.cwd)) {
    return { reason: 'file is outside the project folder' }
  }
  if (isSecretPath(entry.path)) {
    return { reason: WHY.secret }
  }
  const same = turn.entries.filter(e => e.path === entry.path)
  const first = mode === 'file' ? same[0] ?? entry : entry
  const last = mode === 'file' ? same[same.length - 1] ?? entry : entry
  if (first.before === undefined) {
    return { reason: first.beforeSkipped ? WHY[first.beforeSkipped] ?? 'previous version not saved' : 'recorded by an earlier version of the mod' }
  }
  return { plan: { path: entry.path, before: first.before, expectedHash: last.afterHash, changes: mode === 'file' ? same.length : 1 } }
}


export const base = (path: string) => path.split(/[\\/]/).pop() ?? path

/** The question put to the person before anything is touched. */
export function describe(plan: RestorePlan, seen: Inspection, mode: 'one' | 'file'): { message: string; isRisky: boolean } {
  const name = base(plan.path)
  const scope = mode === 'file' && plan.changes > 1 ? `to how it was before the ${plan.changes} changes in this turn` : 'to how it was before this change'
  let message = plan.before === null
    ? `Delete ${name}, created by this change?`
    : `Put ${name} back ${scope}?`
  if (seen.exists) message += ' The current contents are saved to a backup first.'
  else if (plan.before !== null) message += ' The file does not exist now: I will recreate it.'
  const isRisky = seen.isChanged || seen.isUnverifiable
  if (seen.isChanged && seen.exists) message += ' WARNING: the file has changed since this change (including later changes): you will lose those changes too.'
  else if (seen.isUnverifiable) message += ' I cannot verify whether the file has changed since then.'
  return { message, isRisky }
}

export type RestoreOutcome = { isOk: boolean; text: string }

export const isWindowsPath = (path: string) => /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')

