/** One recorded file change: an Edit or a Write, as a unified diff. */
export type ReplayEntry = {
  tool: 'Edit' | 'Write'
  path: string
  /** edit = Edit, create = new file via Write, update = Write over a file */
  kind: 'edit' | 'create' | 'update'
  /** unified-diff hunks (`@@ ... @@` + lines), '' when nothing changed */
  diff: string
  added: number
  removed: number
  at: number
  /** the diff was cut to keep the history file readable */
  truncated?: boolean
  /** the file's text just before this change; null = the file did not exist */
  before?: string | null
  /** why `before` is missing: too big, not readable as text, or the turn file was full */
  beforeSkipped?: 'big' | 'unreadable' | 'budget'
  /** SHA-256 of the file's text just after this change */
  afterHash?: string
}

/** One turn on disk: every change it made, in order. */
export type ReplayTurn = {
  turnId: string
  startedAt: number
  endedAt: number
  /** the prompt that opened the turn, cut short */
  prompt: string
  cwd: string
  project: string
  entries: ReplayEntry[]
}

/** The turn being recorded right now. */
export type ReplayCurrent = { turnId: string; startedAt: number; prompt: string }

/** What the pane shows. */
export type ReplayView = {
  mode: 'diff' | 'history'
  /** history file names, newest first, after the scope filter */
  files: string[]
  scope: 'project' | 'all'
  /** index into files of the turn shown (0 = newest) */
  turnPos: number
  entry: number
  scroll: number
  page: number
  turn: ReplayTurn | null
  error: string | null
  /** the /rewind run whose output row draws the viewer inline (0 = none) */
  inlineSeq: number
  /** the viewer was closed */
  closed: boolean
  /** a restore waiting for the person's confirmation */
  confirm: { mode: 'one' | 'file'; message: string; isRisky: boolean } | null
  /** the outcome of the last restore */
  notice: { isOk: boolean; text: string } | null
}

declare module 'claude-code' {
  interface PluginState {
    'rewind': {
      pending: ReplayEntry[]
      current: ReplayCurrent | null
      view: ReplayView
    }
  }
}
