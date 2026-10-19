// The viewer as plain markdown, for surfaces that draw text but no buttons
// (Claude Desktop's Code tab): the same turns, driven by /rewind sub-commands.
import type { ReplayEntry, ReplayView } from '../types'
import { formatWhen, parseFileName, rowCount, windowDiff } from './diff'
import { planRestore } from './restore'

/** Rows of one diff shown per answer. */
export const TEXT_ROWS = 40
export const HISTORY_PAGE = 10

const KIND: Record<ReplayEntry['kind'], string> = { create: 'new file', update: 'rewritten', edit: 'modified' }

/** A code fence longer than any run of backticks inside the text. */
function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(m => m[0].length))
  return '`'.repeat(longest + 1)
}

export function renderViewer(v: ReplayView): string {
  const total = v.files.length
  if (v.turn === null || v.turn.entries.length === 0) {
    return `🎭 **Rewind**\n\n${v.error ?? 'No changes recorded yet. Each turn\'s Edit/Write shows up here at the end of the turn.'}`
  }
  const turn = v.turn
  const index = Math.min(v.entry, turn.entries.length - 1)
  const entry = turn.entries[index] as ReplayEntry
  const lines = rowCount(entry.diff)
  const scroll = Math.min(v.scroll, Math.max(0, lines - TEXT_ROWS))
  const diff = windowDiff(entry.diff, scroll, TEXT_ROWS)
  const out: string[] = []
  out.push(`🎭 **Turn ${total - v.turnPos}/${total}** · ${formatWhen(turn.startedAt)} · ${turn.project}`)
  if (turn.prompt !== '') out.push(`> ${turn.prompt.replace(/\s+/g, ' ').slice(0, 160)}`)
  if (v.notice !== null) out.push('', `${v.notice.isOk ? '✔' : '✖'} ${v.notice.text}`)
  out.push('', `**Change ${index + 1}/${turn.entries.length}** · ${entry.tool} · ${KIND[entry.kind]} · +${entry.added} −${entry.removed}`, `\`${entry.path}\``, '')
  if (diff === '') {
    out.push(entry.beforeSkipped === 'secret'
      ? '_(contents not recorded: the file looks like it holds a secret)_'
      : '_(no difference to show)_')
  }
  else {
    const f = fence(diff)
    out.push(`${f}diff`, diff, f)
  }
  if (entry.truncated === true) out.push('_… diff truncated in the history because it was too large_')
  if (lines > TEXT_ROWS) out.push(`_lines ${scroll + 1}–${Math.min(lines, scroll + TEXT_ROWS)} of ${lines}: \`/rewind down\` and \`/rewind up\` to scroll_`)
  out.push('')
  if (v.confirm !== null) {
    out.push(`**${v.confirm.isRisky ? '⚠️ ' : ''}${v.confirm.message}**`, '', 'Confirm with `/rewind yes`, cancel with `/rewind no`.')
    return out.join('\n')
  }
  const nav: string[] = ['`/rewind prev`', '`/rewind next`']
  const one = planRestore(turn, index, 'one')
  if ('plan' in one) nav.push(one.plan.before === null ? '`/rewind restore` (delete the created file)' : '`/rewind restore` (file as it was before this change)')
  else nav.push(`restore unavailable: ${one.reason}`)
  const same = turn.entries.filter(x => x.path === entry.path).length
  const whole = planRestore(turn, index, 'file')
  if (same > 1 && 'plan' in whole) nav.push('`/rewind file` (file at the start of the turn)')
  nav.push('`/rewind older` · `/rewind newer` (turns)', '`/rewind history`', '`/rewind close`')
  out.push(nav.join(' · '))
  return out.join('\n')
}

export function renderHistory(v: ReplayView, page: number): string {
  const total = v.files.length
  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE))
  const at = Math.min(Math.max(1, page), pages) - 1
  const scope = v.scope === 'project' ? 'this project' : 'all projects'
  const out = [`🎭 **History** · ${scope} · ${total} ${total === 1 ? 'turn' : 'turns'} · page ${at + 1}/${pages}`, '']
  if (total === 0) out.push('No turns recorded here.')
  v.files.slice(at * HISTORY_PAGE, at * HISTORY_PAGE + HISTORY_PAGE).forEach((name, i) => {
    const meta = parseFileName(name)
    const number = at * HISTORY_PAGE + i + 1
    out.push(meta
      ? `${number}. ${formatWhen(meta.startedAt)} · ${meta.project} · ${meta.count} ${meta.count === 1 ? 'change' : 'changes'}`
      : `${number}. ${name}`)
  })
  out.push('', 'Open a turn with `/rewind <number>`' + (pages > 1 ? ` · other pages: \`/rewind history ${at + 2 > pages ? 1 : at + 2}\`` : ''))
  return out.join('\n')
}
