import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { capHunks, creationHunks, hunksToText, isInsideProject, isSecretPath, legacyProjectSlug, parseTurnJson, projectSlug, prunePlan, rowCount, shortHash, STORE_CAP, windowDiff } from '../hooks/diff'
import { BEFORE_CAP, planRestore } from '../hooks/restore'
import type { ReplayEntry, ReplayTurn } from '../types'

const SURFACES = ['terminal', 'desktop'] as const
const PANE = { plugin: 'rewind', component: 'Pane', requestId: 'rewind' } as const
const PROPS = { title: 'Rewind', isFocused: true, bodyColumns: 100 } as never
const PRESENTATION = { isFullscreen: true, columns: 120 }

/** An in-memory disk, a home, a working directory and a pane host beneath the plugin. */
function world(on: On, cwd = '/work/myproject', placesPanes = true) {
  const disk = new Map<string, string>()
  const toasts: { text: string; timeoutMs?: number }[] = []
  const control = { failHistoryWrite: false, listedSize: undefined as number | undefined }
  let cwdNow = cwd
  const clock = mock.clock(on, { now: 1_759_820_000_000 })
  mock.env(on, { HOME: '/home/user' })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.cwd', () => ({ value: cwdNow }))
  on('fs.write', (_$, e) => {
    if (control.failHistoryWrite && e.path.includes('/history/')) return { deny: 'disco pieno' }
    disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    const text = disk.get(e.path)
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.exists', (_$, e) => ({ value: disk.has(e.path) }))
  on('process.run', (_$, e) => {
    // `rm -f -- <path>` or `cmd /d /c del /f /q <path>`: the file goes
    disk.delete(e.argv[e.argv.length - 1] as string)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.list', (_$, e) => ({
    value: [...disk.keys()]
      .filter(p => p.startsWith(e.path + '/'))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: control.listedSize ?? disk.get(p)?.length ?? 0, mtimeMs: 0, isLink: false })),
  }))
  on('ui.open', () => ({ value: placesPanes ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'nessun pannello su questa app' } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    toasts.push({ text: e.text, timeoutMs: e.timeoutMs })
    return { value: undefined }
  })
  on('command.run', () => ({ text: '' }))
  // the tools themselves: an Edit and a Write that answer as core does
  on('tool.call', (_$, e) => {
    if (e.tool === 'Edit') {
      const text = disk.get(e.file_path)
      if (text !== undefined) disk.set(e.file_path, text.replace(e.old_string, e.new_string))
      return {
        result: {
          filePath: e.file_path, oldString: e.old_string, newString: e.new_string, originalFile: 'a\nb\nc\n',
          structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [' a', '-' + e.old_string, '+' + e.new_string, ' c'] }],
          userModified: false, replaceAll: false,
        },
      }
    }
    if (e.tool === 'Write') {
      disk.set(e.file_path, e.content)
      return { result: { type: 'create', filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: null } }
    }
    return { result: 'ok' }
  })
  return { disk, clock, toasts, control, setCwd: (next: string) => { cwdNow = next } }
}

async function turn($: any, turnId: string, text: string, edits: () => Promise<void>) {
  await $.turn.start({ text, turnId })
  await edits()
  await $.turn.complete({ answer: 'fatto', durationMs: 10, isAborted: false, turnId, reason: 'answer' })
}

describe('diff helpers', () => {
  test('a window of a long diff still parses as hunks with true line numbers', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => ' riga ' + (i + 1))
    lines.splice(20, 1, '-riga 21', '+riga ventuno')
    const diff = hunksToText([{ oldStart: 1, oldLines: 30, newStart: 1, newLines: 30, lines }])
    expect(rowCount(diff)).toBe(31)
    const win = windowDiff(diff, 18, 5)
    expect(win.startsWith('@@ -19,4 +19,4 @@')).toBe(true)
    expect(win).toContain('-riga 21')
  })

  test('same-named folders get different slugs, and the old folder-only slug stays available', () => {
    const one = projectSlug('/work/one/app')
    const two = projectSlug('/work/two/app')
    expect(one).not.toBe(two)
    expect(one).toBe(`app-${one.slice(-8)}`)
    expect(one).toMatch(/^app-[0-9a-f]{8}$/)
    expect(legacyProjectSlug('/work/one/app')).toBe('app')
    expect(projectSlug('/work/one/app/')).toBe(one)
    expect(projectSlug('C:\\Work\\App')).toBe(projectSlug('c:/Work/App'))
  })

  test('a path is inside the project after Windows separators and drive-letter case are folded', () => {
    expect(isInsideProject('c:/Work/MyProject/a.ts', 'C:\\Work\\MyProject')).toBe(true)
    expect(isInsideProject('C:/Work/MyProject/../Other/b.ts', 'C:\\Work\\MyProject')).toBe(false)
    expect(isInsideProject('C:/Work/MyProject2/c.ts', 'C:\\Work\\MyProject')).toBe(false)
    expect(isInsideProject('D:\\Work\\MyProject\\d.ts', 'C:\\Work\\MyProject')).toBe(false)
    expect(isInsideProject('src/a.ts', '/work/myproject')).toBe(true)
    expect(isInsideProject('/work/myproject/../other/a.ts', '/work/myproject')).toBe(false)
    expect(isSecretPath('/work/myproject/.env')).toBe(true)
    expect(isSecretPath('/work/myproject/.env.local')).toBe(true)
    expect(isSecretPath('/work/myproject/.envrc')).toBe(false)
    expect(isSecretPath('C:\\keys\\server.pem')).toBe(true)
    expect(isSecretPath('/work/myproject/id_rsa.pub')).toBe(true)
    expect(isSecretPath('/work/myproject/id_ed25519')).toBe(true)
    expect(isSecretPath('/work/myproject/id_ed25519.pub')).toBe(true)
    expect(isSecretPath('C:\\keys\\id_ecdsa')).toBe(true)
    expect(isSecretPath('/work/myproject/id_dsa.pub')).toBe(true)
    expect(isSecretPath('/work/myproject/.npmrc')).toBe(true)
    expect(isSecretPath('/work/myproject/.pypirc')).toBe(true)
    expect(isSecretPath('/home/user/.netrc')).toBe(true)
    expect(isSecretPath('/work/myproject/.htpasswd')).toBe(true)
    expect(isSecretPath('/work/myproject/cert.p12')).toBe(true)
    expect(isSecretPath('/work/myproject/cert.pfx')).toBe(true)
    expect(isSecretPath('/work/myproject/store.jks')).toBe(true)
    expect(isSecretPath('/work/myproject/src/credentials.ts')).toBe(true)
    expect(isSecretPath('/work/myproject/ok.ts')).toBe(false)
  })

  test('parseTurnJson accepts a turn and rejects a partial file', () => {
    const raw = JSON.stringify({ turnId: 't', startedAt: 1, project: 'p', entries: [] })
    expect(parseTurnJson(raw).turnId).toBe('t')
    expect(() => parseTurnJson('{"turnId":"x"}')).toThrow(/Invalid ReplayTurn schema/)
    expect(() => parseTurnJson('null')).toThrow(/Invalid ReplayTurn schema/)
  })

  test('planRestore refuses a path outside the project and a secret path', () => {
    const entry = (path: string): ReplayEntry => ({ tool: 'Edit', path, kind: 'edit', diff: '', added: 0, removed: 0, at: 1, before: 'saved\n' })
    const turn = (path: string): ReplayTurn => ({
      turnId: 't', startedAt: 1, endedAt: 2, prompt: '', cwd: '/work/myproject', project: 'p', entries: [entry(path)],
    })
    const secret = 'the file looks like it holds a secret, so its text was not saved'
    expect(planRestore(turn('/tmp/other.ts'), 0, 'one')).toEqual({ reason: 'file is outside the project folder' })
    expect(planRestore(turn('../other.ts'), 0, 'one')).toEqual({ reason: 'file is outside the project folder' })
    expect(planRestore(turn('/work/myproject/.npmrc'), 0, 'one')).toEqual({ reason: secret })
    expect(planRestore(turn('/work/myproject/id_ed25519'), 0, 'one')).toEqual({ reason: secret })
    expect(planRestore(turn('/work/myproject/cert.p12'), 0, 'one')).toEqual({ reason: secret })
    const ok = planRestore(turn('/work/myproject/ok.ts'), 0, 'one')
    expect('plan' in ok && ok.plan.path).toBe('/work/myproject/ok.ts')
  })

  test('oldest turns, then oldest backups, are the ones past the store cap', () => {
    const history = (name: string, size: number) => ({ name, size, kind: 'history' as const })
    const backup = (name: string, size: number) => ({ name, size, kind: 'backup' as const })
    expect(prunePlan([history('100_1_a.json', 10), history('200_1_a.json', 10)], 20)).toEqual([])
    const dropped = prunePlan([
      history('100_1_a.json', 10),
      history('200_1_a.json', 10),
      history('300_1_a.json', 10),
      backup('150_a.txt', 10),
      backup('250_b.txt', 10),
    ], 25)
    expect(dropped.map(f => f.name)).toEqual(['100_1_a.json', '200_1_a.json', '150_a.txt'])
    expect(prunePlan([history('300_1_a.json', STORE_CAP + 1)], STORE_CAP)).toEqual([])
  })

  test('a created file is all additions, and a huge diff is cut on whole lines', async () => {
    const text = hunksToText(creationHunks('x\ny\n'))
    expect(text).toBe('@@ -0,0 +1,2 @@\n+x\n+y')
    const big = creationHunks(Array.from({ length: 5000 }, () => 'z'.repeat(80)).join('\n'))
    const cut = capHunks(big, 10_000)
    expect(cut.truncated).toBe(true)
    expect(hunksToText(cut.hunks).length).toBeLessThan(10_100)
  })
})

describe('recording and replay', () => {
  test('edits of a turn are saved at turn end and shown one at a time', async ($, on) => {
    const { disk } = world(on)
    await turn($, 't1', 'sistema il login', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/a.ts', old_string: 'b', new_string: 'B' })
      await $.tool.call({ tool: 'Write', file_path: '/work/myproject/new.ts', content: 'export const x = 1\n' })
      await $.tool.call({ tool: 'Bash', command: 'ls' })
    })
    const files = [...disk.keys()].filter(path => path.includes('/history/'))
    expect(files).toHaveLength(1)
    expect(files[0]).toBe(`/home/user/.claude/replay-theater/history/1759820000000_2_${projectSlug('/work/myproject')}.json`)
    const saved = JSON.parse(disk.get(files[0] as string) as string)
    expect(saved.prompt).toBe('sistema il login')
    expect(saved.entries.map((x: any) => x.kind)).toEqual(['edit', 'create'])

    await $.command.run({ command: 'rewind', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION } as any)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface, props: PROPS, viewport: { columns: 120, rows: 40 } })
      expect((await ui.find({ type: 'Code' }))?.text).toContain('+B')
      await ui.press({ key: 'next' })
      expect((await ui.find({ type: 'Code' }))?.text).toContain('+export const x = 1')
      await ui.press({ key: 'prev' })
      expect((await ui.find({ type: 'Code' }))?.text).toContain('-b')
      expect(await ui.find({ key: 'close' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('Prev walks back across turns, and the history lists every turn', async ($, on) => {
    const { clock } = world(on)
    await turn($, 'old', 'primo', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/one.ts', old_string: 'uno', new_string: 'UNO' })
    })
    await clock.advance(60_000)
    await turn($, 'new', 'secondo', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/two.ts', old_string: 'due', new_string: 'DUE' })
    })
    await turn($, 'none', 'solo domande', async () => {})

    await $.command.run({ command: 'rewind', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION } as any)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS, viewport: { columns: 120, rows: 40 } })
    expect((await ui.find({ type: 'Code' }))?.text).toContain('+DUE')
    await ui.press({ key: 'prev' })
    expect((await ui.find({ type: 'Code' }))?.text).toContain('+UNO')
    await ui.press({ key: 'history' })
    expect(await ui.findAll({ type: 'Button', text: /change/ })).toHaveLength(2)
    await ui.press({ key: 'turn-0' })
    expect((await ui.find({ type: 'Code' }))?.text).toContain('+DUE')
    await ui.unmount()
  })

  test('where no pane can be placed, /rewind draws the viewer in its own output row', async ($, on) => {
    world(on, '/work/myproject', false)
    await turn($, 't1', 'prova', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/a.ts', old_string: 'b', new_string: 'B' })
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/c.ts', old_string: 'x', new_string: 'X' })
    })
    const ran = await $.command.run({ command: 'rewind', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION } as any)
    expect(ran.text).toContain('#1')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: 'rewind', surface, component: 'CommandOutput',
        props: { command: 'rewind', args: '', text: ran.text ?? '', isErrored: false } as never,
      })
      expect((await ui.find({ type: 'Code' }))?.text).toContain('+B')
      await ui.press({ key: 'next' })
      expect((await ui.find({ type: 'Code' }))?.text).toContain('+X')
      await ui.press({ key: 'prev' })
      await ui.unmount()
    }
    const ui = await $.ui.mount({ plugin: 'rewind', surface: 'desktop', component: 'CommandOutput', props: { command: 'rewind', args: '', text: ran.text ?? '', isErrored: false } as never })
    await ui.press({ key: 'close' })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /closed/ }))).toBeDefined()
  })

  test('a partial turn file is reported when /rewind opens it', async ($, on) => {
    const { disk } = world(on)
    const name = `1759820000000_1_${projectSlug('/work/myproject')}.json`
    disk.set(`/home/user/.claude/replay-theater/history/${name}`, '{"turnId":"x"}')
    await $.command.run({ command: 'rewind', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION } as any)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS, viewport: { columns: 120, rows: 40 } })
    const text = (await ui.find({ type: 'Text', text: /Could not read/ }))?.text
    expect(text).toContain(`Could not read ${name}`)
    expect(text).toContain('Invalid ReplayTurn schema')
    await ui.unmount()
  })
})

describe('end-of-turn toasts', () => {
  test('the saved toast stays 10s and the failure toast stays 15s', async ($, on) => {
    const { toasts, control } = world(on)
    await turn($, 't1', 'sistema', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/a.ts', old_string: 'b', new_string: 'B' })
    })
    expect(toasts).toEqual([
      { text: '🎭 1 change recorded · /rewind to review them', timeoutMs: 10_000 },
    ])

    control.failHistoryWrite = true
    await turn($, 't2', 'ancora', async () => {
      await $.tool.call({ tool: 'Write', file_path: '/work/myproject/b.ts', content: 'uno\n' })
      await $.tool.call({ tool: 'Write', file_path: '/work/myproject/c.ts', content: 'due\n' })
    })
    expect(toasts).toHaveLength(2)
    expect(toasts[1]?.text.startsWith('Rewind: save failed')).toBe(true)
    expect(toasts[1]?.timeoutMs).toBe(15_000)
  })
})

describe('restoring a file to before a change', () => {
  const OPEN = { command: 'rewind', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION } as never
  const VIEW = { viewport: { columns: 120, rows: 40 } }

  test('asks first, backs the current text up, then puts the old text back', async ($, on) => {
    const { disk } = world(on)
    disk.set('/work/myproject/a.txt', 'uno\ndue\ntre\n')
    await turn($, 't1', 'maiuscole', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/a.txt', old_string: 'due', new_string: 'DUE' })
    })
    expect(disk.get('/work/myproject/a.txt')).toBe('uno\nDUE\ntre\n')
    await $.command.run(OPEN)
    for (const surface of SURFACES) {
      disk.set('/work/myproject/a.txt', 'uno\nDUE\ntre\n')
      await $.command.run(OPEN)
      const ui = await $.ui.mount({ ...PANE, surface, props: PROPS, ...VIEW })
      await ui.press({ key: 'restore' })
      expect(disk.get('/work/myproject/a.txt')).toBe('uno\nDUE\ntre\n') // nothing changes before the yes
      expect((await ui.find({ type: 'Text', text: /Put a\.txt back/ }))?.text).not.toContain('WARNING')
      await ui.press({ key: 'confirm' })
      expect(disk.get('/work/myproject/a.txt')).toBe('uno\ndue\ntre\n')
      expect((await ui.find({ type: 'Text', text: /Restored/ }))).toBeDefined()
      await ui.unmount()
    }
    const backups = [...disk.entries()].filter(([path]) => path.includes('/replay-theater/backups/'))
    expect(backups.length).toBeGreaterThan(0)
    expect(backups.some(([, text]) => text === 'uno\nDUE\ntre\n')).toBe(true)
  })

  test('warns when the file changed since, and Cancel leaves it alone', async ($, on) => {
    const { disk } = world(on)
    disk.set('/work/myproject/b.txt', 'uno\ndue\n')
    await turn($, 't1', 'x', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/b.txt', old_string: 'due', new_string: 'DUE' })
    })
    disk.set('/work/myproject/b.txt', 'scritto da me dopo\n')
    await $.command.run(OPEN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS, ...VIEW })
    await ui.press({ key: 'restore' })
    expect((await ui.find({ type: 'Text', text: /WARNING/ }))).toBeDefined()
    await ui.press({ key: 'cancel' })
    expect(disk.get('/work/myproject/b.txt')).toBe('scritto da me dopo\n')
    expect(await ui.find({ key: 'confirm' })).toBeUndefined()
  })

  test('a file the change created is deleted, after a backup', async ($, on) => {
    const { disk } = world(on)
    await turn($, 't1', 'crea', async () => {
      await $.tool.call({ tool: 'Write', file_path: '/work/myproject/nuovo.txt', content: 'ciao\n' })
    })
    expect(disk.get('/work/myproject/nuovo.txt')).toBe('ciao\n')
    await $.command.run(OPEN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS, ...VIEW })
    expect((await ui.find({ key: 'restore' }))?.text).toContain('Delete created file')
    await ui.press({ key: 'restore' })
    await ui.press({ key: 'confirm' })
    expect(disk.has('/work/myproject/nuovo.txt')).toBe(false)
    expect([...disk.entries()].some(([path, text]) => path.includes('/backups/') && text === 'ciao\n')).toBe(true)
  })

  test('the whole file goes back to before the turn, across several edits', async ($, on) => {
    const { disk } = world(on)
    disk.set('/work/myproject/c.txt', 'a b c\n')
    await turn($, 't1', 'due edit', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/c.txt', old_string: 'a', new_string: 'A' })
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/c.txt', old_string: 'c', new_string: 'C' })
    })
    expect(disk.get('/work/myproject/c.txt')).toBe('A b C\n')
    await $.command.run(OPEN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS, ...VIEW })
    await ui.press({ key: 'prev' }) // the first of the two
    await ui.press({ key: 'restore-file' })
    await ui.press({ key: 'confirm' })
    expect(disk.get('/work/myproject/c.txt')).toBe('a b c\n')
  })

  test('same-named files in different folders get different backup names', async ($, on) => {
    const { disk } = world(on)
    disk.set('/work/myproject/src/a/index.ts', 'a\n')
    disk.set('/work/myproject/src/b/index.ts', 'b\n')
    await turn($, 't1', 'due index', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/src/a/index.ts', old_string: 'a', new_string: 'A' })
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/src/b/index.ts', old_string: 'b', new_string: 'B' })
    })
    await $.command.run(OPEN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS, ...VIEW })
    await ui.press({ key: 'restore' })
    await ui.press({ key: 'confirm' })
    await ui.press({ key: 'next' })
    await ui.press({ key: 'restore' })
    await ui.press({ key: 'confirm' })
    const backups = [...disk.keys()].filter(path => path.includes('/replay-theater/backups/'))
    expect(backups).toHaveLength(2)
    expect(backups.some(path => path.includes(shortHash('/work/myproject/src/a/index.ts')))).toBe(true)
    expect(backups.some(path => path.includes(shortHash('/work/myproject/src/b/index.ts')))).toBe(true)
    await ui.unmount()
  })

  test('a file too large to restore is not read again for a hash', async ($, on) => {
    let reads = 0
    on('fs.read', async (_$, e, next) => {
      reads++
      return next(e)
    })
    const { disk } = world(on)
    disk.set('/work/myproject/small.txt', 'a\n')
    disk.set('/work/myproject/big.txt', 'z'.repeat(BEFORE_CAP + 1))
    await $.turn.start({ text: 'sizes', turnId: 'sizes' })
    reads = 0
    await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/small.txt', old_string: 'a', new_string: 'A' })
    expect(reads).toBe(2)
    reads = 0
    await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/big.txt', old_string: 'z', new_string: 'Z' })
    expect(reads).toBe(1)
    await $.turn.complete({ answer: 'fatto', durationMs: 10, isAborted: false, turnId: 'sizes', reason: 'answer' })
    const saved = [...disk.entries()].find(([path]) => path.includes('/history/'))
    const turn = JSON.parse(saved?.[1] ?? '{}')
    expect(turn.entries.find((e: { path: string }) => e.path.endsWith('big.txt')).beforeSkipped).toBe('big')
    expect(turn.entries.find((e: { path: string }) => e.path.endsWith('big.txt')).afterHash).toBeUndefined()
    expect(turn.entries.find((e: { path: string }) => e.path.endsWith('small.txt')).afterHash).toBeDefined()
  })

  test('no restore for a change recorded without its earlier text', async ($, on) => {
    const { disk } = world(on)
    await turn($, 't1', 'edit su file che non c\'era', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/fantasma.txt', old_string: 'x', new_string: 'y' })
    })
    await $.command.run(OPEN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS, ...VIEW })
    expect(await ui.find({ key: 'restore' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /Restore unavailable/ }))).toBeDefined()
    expect(disk.has('/work/myproject/fantasma.txt')).toBe(false)
  })

  test('the buttons come before the diff, so a short pane never cuts them off', async ($, on) => {
    const { disk } = world(on)
    disk.set('/work/myproject/d.txt', 'uno\ndue\n')
    await turn($, 't1', 'x', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/d.txt', old_string: 'due', new_string: 'DUE' })
    })
    await $.command.run(OPEN)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface, props: PROPS, ...VIEW })
      const tree = JSON.stringify(await ui.drawn())
      for (const key of ['prev', 'next', 'close', 'restore']) {
        expect(tree.indexOf(`"${key}"`)).toBeGreaterThan(-1)
        expect(tree.indexOf(`"${key}"`)).toBeLessThan(tree.indexOf('"diff"'))
      }
      await ui.unmount()
    }
  })
})

describe('subagents, secrets, project boundaries and old history', () => {
  const OPEN = { command: 'rewind', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION } as never

  test('a subagent turn does not reset the main one, and a start without text still records', async ($, on) => {
    const { disk, clock } = world(on)
    await $.turn.start({ turnId: 'main' } as never)
    await clock.advance(5_000)
    await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/a.ts', old_string: 'b', new_string: 'B' })
    await $.turn.start({ text: 'fai tu', turnId: 'sub', agentId: 'agent-1' })
    await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/b.ts', old_string: 'c', new_string: 'C' })
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 'sub', reason: 'answer', agentId: 'agent-1' })
    expect([...disk.keys()].filter(path => path.includes('/history/'))).toHaveLength(0)
    await $.turn.complete({ answer: 'fatto', durationMs: 1, isAborted: false, turnId: 'main', reason: 'answer' })
    const files = [...disk.keys()].filter(path => path.includes('/history/'))
    expect(files).toHaveLength(1)
    const saved = JSON.parse(disk.get(files[0] as string) as string)
    expect(saved.turnId).toBe('main')
    expect(saved.prompt).toBe('')
    expect(saved.startedAt).toBe(1_759_820_000_000)
    expect(saved.entries.map((e: { path: string }) => e.path)).toEqual(['/work/myproject/a.ts', '/work/myproject/b.ts'])
  })

  test('a secret file is recorded as modified, without its text or a backup of it', async ($, on) => {
    const { disk } = world(on)
    disk.set('/work/myproject/.env', 'TOKEN=SUPERSECRETVALUE\n')
    disk.set('/work/myproject/id_rsa', '-----BEGIN KEY SUPERSECRETVALUE-----\n')
    disk.set('/work/myproject/id_ed25519', 'ed25519 SUPERSECRETVALUE\n')
    disk.set('/work/myproject/.envrc', 'export PUBLIC=1\n')
    disk.set('/work/myproject/ok.ts', 'pubblico\n')
    await turn($, 't1', 'segreti', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/.env', old_string: 'SUPERSECRETVALUE', new_string: 'OTHERSECRETVALUE' })
      await $.tool.call({ tool: 'Write', file_path: '/work/myproject/certs/server.pem', content: 'CERT SUPERSECRETVALUE\n' })
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/id_rsa', old_string: 'KEY', new_string: 'KEY2' })
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/id_ed25519', old_string: 'SUPERSECRETVALUE', new_string: 'OTHER' })
      await $.tool.call({ tool: 'Write', file_path: '/work/myproject/.npmrc', content: '//registry:_authToken=SUPERSECRETVALUE\n' })
      await $.tool.call({ tool: 'Write', file_path: '/work/myproject/cert.p12', content: 'P12 SUPERSECRETVALUE\n' })
      await $.tool.call({ tool: 'Write', file_path: '/work/myproject/src/credentials.ts', content: 'export const CREDENTIALS = "SUPERSECRETVALUE"\n' })
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/.envrc', old_string: 'PUBLIC', new_string: 'PUBLIC2' })
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/ok.ts', old_string: 'pubblico', new_string: 'PUBBLICO' })
    })
    const files = [...disk.keys()].filter(path => path.includes('/history/'))
    const saved = JSON.parse(disk.get(files[0] as string) as string)
    expect(saved.entries.map((e: { path: string }) => e.path)).toEqual([
      '/work/myproject/.env',
      '/work/myproject/certs/server.pem',
      '/work/myproject/id_rsa',
      '/work/myproject/id_ed25519',
      '/work/myproject/.npmrc',
      '/work/myproject/cert.p12',
      '/work/myproject/src/credentials.ts',
      '/work/myproject/.envrc',
      '/work/myproject/ok.ts',
    ])
    for (const entry of saved.entries) {
      if (entry.path.endsWith('.envrc') || entry.path.endsWith('ok.ts')) {
        expect(entry.diff).not.toBe('')
        expect(entry.beforeSkipped).toBeUndefined()
      } else {
        expect(entry.diff).toBe('')
        expect(entry.before).toBeUndefined()
        expect(entry.afterHash).toBeUndefined()
        expect(entry.added).toBe(0)
        expect(entry.removed).toBe(0)
        expect(entry.beforeSkipped).toBe('secret')
      }
    }
    expect(disk.get(files[0] as string)).not.toContain('SUPERSECRETVALUE')
    expect([...disk.entries()].some(([path, text]) => path.includes('/backups/') && text.includes('SUPERSECRETVALUE'))).toBe(false)
    const kept = saved.entries.find((e: { path: string }) => e.path.endsWith('.envrc'))
    expect(kept.before).toBe('export PUBLIC=1\n')
    expect(kept.diff).toContain('PUBLIC2')
  })

  test('files outside the project folder are not recorded', async ($, on) => {
    const { disk } = world(on, 'C:\\Work\\MyProject')
    await turn($, 't1', 'win', async () => {
      await $.tool.call({ tool: 'Edit', file_path: 'c:/Work/MyProject/a.ts', old_string: 'b', new_string: 'B' })
      await $.tool.call({ tool: 'Edit', file_path: 'C:/Work/MyProject/../Other/b.ts', old_string: 'b', new_string: 'B' })
      await $.tool.call({ tool: 'Edit', file_path: 'C:/Work/MyProject2/c.ts', old_string: 'b', new_string: 'B' })
      await $.tool.call({ tool: 'Edit', file_path: 'D:\\Work\\MyProject\\d.ts', old_string: 'b', new_string: 'B' })
      await $.tool.call({ tool: 'Edit', file_path: 'src/in.ts', old_string: 'b', new_string: 'B' })
    })
    const files = [...disk.keys()].filter(path => path.includes('/history/'))
    const saved = JSON.parse(disk.get(files[0] as string) as string)
    expect(saved.entries.map((e: { path: string }) => e.path)).toEqual(['c:/Work/MyProject/a.ts', 'src/in.ts'])
  })

  test('two projects with the same folder name do not share new turns, and the old slug still opens', async ($, on) => {
    const { disk, clock, setCwd } = world(on, '/work/one/app')
    const legacyName = `/home/user/.claude/replay-theater/history/1759810000000_1_${legacyProjectSlug('/work/one/app')}.json`
    disk.set(legacyName, JSON.stringify({
      turnId: 'old', startedAt: 1_759_810_000_000, endedAt: 2, prompt: 'vecchio', cwd: '/work/one/app', project: 'app',
      entries: [{ tool: 'Edit', path: '/work/one/app/old.ts', kind: 'edit', diff: '@@ -1 +1 @@\n-a\n+LEGACYDIFF', added: 1, removed: 1, at: 1 }],
    }))
    await clock.advance(60_000)
    await turn($, 't1', 'primo', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/work/one/app/a.ts', old_string: 'b', new_string: 'ONE' })
    })
    setCwd('/work/two/app')
    await clock.advance(60_000)
    await turn($, 't2', 'secondo', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/work/two/app/b.ts', old_string: 'b', new_string: 'TWO' })
    })
    await $.command.run(OPEN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS, viewport: { columns: 120, rows: 40 } })
    expect((await ui.find({ type: 'Code' }))?.text).toContain('+TWO')
    await ui.press({ key: 'history' })
    expect(await ui.find({ type: 'Button', text: new RegExp(projectSlug('/work/two/app')) })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: new RegExp(projectSlug('/work/one/app')) })).toBeUndefined()
    await ui.unmount()

    setCwd('/work/one/app')
    await $.command.run(OPEN)
    const again = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS, viewport: { columns: 120, rows: 40 } })
    await again.press({ key: 'history' })
    expect(await again.find({ type: 'Button', text: / · app · / })).toBeDefined()
    await again.press({ key: 'turn-1' })
    expect((await again.find({ type: 'Code' }))?.text).toContain('+LEGACYDIFF')
  })

  test('turns past the store cap are deleted oldest first', async ($, on) => {
    const { disk, clock, control } = world(on)
    control.listedSize = STORE_CAP
    await turn($, 'old', 'primo', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/a.ts', old_string: 'b', new_string: 'OLD' })
    })
    expect([...disk.keys()].filter(path => path.includes('/history/'))).toHaveLength(1)
    await clock.advance(60_000)
    await turn($, 'new', 'secondo', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/work/myproject/a.ts', old_string: 'b', new_string: 'NEW' })
    })
    const left = [...disk.keys()].filter(path => path.includes('/history/'))
    expect(left).toHaveLength(1)
    expect(JSON.parse(disk.get(left[0] as string) as string).prompt).toBe('secondo')
  })
})
