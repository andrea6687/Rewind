// Pure helpers: building, cutting and windowing unified diffs, and naming
// history files. No `$` here, so the tests can call them directly.

export type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

/** One line of a diff with the numbers it stands at, headers dropped. */
type Row = { hunk: number; mark: ' ' | '+' | '-'; text: string; oldNo: number; newNo: number }

/** Largest diff kept per change, and per turn file (a $.fs.read takes 4 MiB). */
export const ENTRY_CAP = 150_000
export const TURN_CAP = 2_000_000

const isBody = (line: string) => line[0] === ' ' || line[0] === '+' || line[0] === '-'

/** Hunks back to text, each header recounted from its own lines. */
export function hunksToText(hunks: readonly Hunk[]): string {
  return hunks
    .filter(h => h.lines.some(isBody))
    .map(h => {
      const body = h.lines.filter(isBody)
      const oldN = body.filter(l => l[0] !== '+').length
      const newN = body.filter(l => l[0] !== '-').length
      return `@@ -${h.oldStart},${oldN} +${h.newStart},${newN} @@\n${body.join('\n')}`
    })
    .join('\n')
}

/** A whole file as added lines (a Write that created it). */
export function creationHunks(content: string): Hunk[] {
  if (content === '') return []
  const lines = content.replace(/\n$/, '').split('\n')
  return [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: lines.map(l => '+' + l) }]
}

/** An Edit's strings as one hunk, when the tool reported no patch. */
export function stringHunks(oldString: string, newString: string): Hunk[] {
  const a = oldString === '' ? [] : oldString.split('\n')
  const b = newString === '' ? [] : newString.split('\n')
  if (a.length + b.length === 0) return []
  return [{ oldStart: 1, oldLines: a.length, newStart: 1, newLines: b.length, lines: [...a.map(l => '-' + l), ...b.map(l => '+' + l)] }]
}

export function countChanges(hunks: readonly Hunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const h of hunks) for (const l of h.lines) {
    if (l[0] === '+') added++
    else if (l[0] === '-') removed++
  }
  return { added, removed }
}

/** Keeps whole hunks up to `cap` characters, cutting the last one by lines. */
export function capHunks(hunks: readonly Hunk[], cap: number): { hunks: Hunk[]; truncated: boolean } {
  const kept: Hunk[] = []
  let used = 0
  for (const h of hunks) {
    const size = h.lines.reduce((n, l) => n + l.length + 1, 40)
    if (used + size <= cap) {
      kept.push(h)
      used += size
      continue
    }
    const lines: string[] = []
    let room = cap - used - 40
    for (const l of h.lines) {
      if (room - (l.length + 1) < 0) break
      lines.push(l)
      room -= l.length + 1
    }
    if (lines.some(isBody)) kept.push({ ...h, lines })
    return { hunks: kept, truncated: true }
  }
  return { hunks: kept, truncated: false }
}

/** Parses diff text back into numbered rows. */
function toRows(diff: string): Row[] {
  const rows: Row[] = []
  let hunk = -1
  let oldNo = 0
  let newNo = 0
  for (const line of diff.split('\n')) {
    const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (head) {
      hunk++
      oldNo = Number(head[1])
      newNo = Number(head[2])
      // a hunk that starts at 0 (a new file) counts from line 1
      if (oldNo === 0) oldNo = 1
      if (newNo === 0) newNo = 1
      continue
    }
    if (hunk < 0 || !isBody(line)) continue
    const mark = line[0] as Row['mark']
    rows.push({ hunk, mark, text: line.slice(1), oldNo, newNo })
    if (mark !== '+') oldNo++
    if (mark !== '-') newNo++
  }
  return rows
}

export function rowCount(diff: string): number {
  return toRows(diff).length
}

/**
 * The rows [from, from + size) of a diff as a diff of their own, each run of
 * one hunk under a header that states where it stands, so the window parses.
 */
export function windowDiff(diff: string, from: number, size: number): string {
  const rows = toRows(diff).slice(from, from + size)
  const parts: string[] = []
  let i = 0
  while (i < rows.length) {
    const first = rows[i] as Row
    const run: Row[] = []
    for (let row = rows[i]; row !== undefined && row.hunk === first.hunk; row = rows[++i]) run.push(row)
    const oldN = run.filter(r => r.mark !== '+').length
    const newN = run.filter(r => r.mark !== '-').length
    const oldStart = oldN === 0 ? first.oldNo - 1 : first.oldNo
    const newStart = newN === 0 ? first.newNo - 1 : first.newNo
    parts.push(`@@ -${oldStart},${oldN} +${newStart},${newN} @@\n${run.map(r => r.mark + r.text).join('\n')}`)
  }
  return parts.join('\n')
}

/** A short, file-name-safe label for a working directory. */
export function projectSlug(cwd: string): string {
  const base = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  const slug = base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
  return slug === '' ? 'root' : slug
}

/** `<13-digit ms>_<changes>_<project>.json`: sorts by time as text. */
export function turnFileName(startedAt: number, count: number, project: string): string {
  return `${String(Math.floor(startedAt)).padStart(13, '0')}_${count}_${project}.json`
}

export function parseFileName(name: string): { startedAt: number; count: number; project: string } | null {
  const m = /^(\d{13})_(\d+)_(.+)\.json$/.exec(name)
  return m ? { startedAt: Number(m[1]), count: Number(m[2]), project: m[3] ?? '' } : null
}

const pad = (n: number) => String(n).padStart(2, '0')

/** dd/mm/yyyy hh:mm in local time. */
export function formatWhen(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
