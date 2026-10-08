import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { capHunks, creationHunks, hunksToText, rowCount, windowDiff } from '../hooks/diff'

const SURFACES = ['terminal', 'desktop'] as const
const PANE = { plugin: 'rewind', component: 'Pane', requestId: 'rewind' } as const
const PROPS = { title: 'Rewind', isFocused: true, bodyColumns: 100 } as never
const PRESENTATION = { isFullscreen: true, columns: 120 }

/** An in-memory disk, a home, a working directory and a pane host beneath the plugin. */
function world(on: On, cwd = '/work/myproject', placesPanes = true) {
  const disk = new Map<string, string>()
  const clock = mock.clock(on, { now: 1_759_820_000_000 })
  mock.env(on, { HOME: '/home/user' })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.cwd', () => ({ value: cwd }))
  on('fs.write', (_$, e) => {
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
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('ui.open', () => ({ value: placesPanes ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'nessun pannello su questa app' } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
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
  return { disk, clock }
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
    expect(files[0]).toMatch(/^\/home\/andrea\/\.claude\/replay-theater\/history\/\d{13}_2_myproject\.json$/)
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
      await $.tool.call({ tool: 'Edit', file_path: '/w/one.ts', old_string: 'uno', new_string: 'UNO' })
    })
    await clock.advance(60_000)
    await turn($, 'new', 'secondo', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/w/two.ts', old_string: 'due', new_string: 'DUE' })
    })
    await turn($, 'none', 'solo domande', async () => {})

    await $.command.run({ command: 'rewind', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION } as any)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS, viewport: { columns: 120, rows: 40 } })
    expect((await ui.find({ type: 'Code' }))?.text).toContain('+DUE')
    await ui.press({ key: 'prev' })
    expect((await ui.find({ type: 'Code' }))?.text).toContain('+UNO')
    await ui.press({ key: 'history' })
    expect(await ui.findAll({ type: 'Button', text: /modific/ })).toHaveLength(2)
    await ui.press({ key: 'turn-0' })
    expect((await ui.find({ type: 'Code' }))?.text).toContain('+DUE')
    await ui.unmount()
  })

  test('where no pane can be placed, /rewind draws the viewer in its own output row', async ($, on) => {
    world(on, '/work/myproject', false)
    await turn($, 't1', 'prova', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: 'b', new_string: 'B' })
      await $.tool.call({ tool: 'Edit', file_path: '/w/c.ts', old_string: 'x', new_string: 'X' })
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
    expect((await ui.find({ type: 'Text', text: /chiuso/ }))).toBeDefined()
  })
})

describe('restoring a file to before a change', () => {
  const OPEN = { command: 'rewind', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION } as never
  const VIEW = { viewport: { columns: 120, rows: 40 } }

  test('asks first, backs the current text up, then puts the old text back', async ($, on) => {
    const { disk } = world(on)
    disk.set('/w/a.txt', 'uno\ndue\ntre\n')
    await turn($, 't1', 'maiuscole', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/w/a.txt', old_string: 'due', new_string: 'DUE' })
    })
    expect(disk.get('/w/a.txt')).toBe('uno\nDUE\ntre\n')
    await $.command.run(OPEN)
    for (const surface of SURFACES) {
      disk.set('/w/a.txt', 'uno\nDUE\ntre\n')
      await $.command.run(OPEN)
      const ui = await $.ui.mount({ ...PANE, surface, props: PROPS, ...VIEW })
      await ui.press({ key: 'restore' })
      expect(disk.get('/w/a.txt')).toBe('uno\nDUE\ntre\n') // nothing changes before the yes
      expect((await ui.find({ type: 'Text', text: /Riportare a\.txt/ }))?.text).not.toContain('ATTENZIONE')
      await ui.press({ key: 'confirm' })
      expect(disk.get('/w/a.txt')).toBe('uno\ndue\ntre\n')
      expect((await ui.find({ type: 'Text', text: /Ripristinato/ }))).toBeDefined()
      await ui.unmount()
    }
    const backups = [...disk.entries()].filter(([path]) => path.includes('/replay-theater/backups/'))
    expect(backups.length).toBeGreaterThan(0)
    expect(backups.some(([, text]) => text === 'uno\nDUE\ntre\n')).toBe(true)
  })

  test('warns when the file changed since, and Annulla leaves it alone', async ($, on) => {
    const { disk } = world(on)
    disk.set('/w/b.txt', 'uno\ndue\n')
    await turn($, 't1', 'x', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/w/b.txt', old_string: 'due', new_string: 'DUE' })
    })
    disk.set('/w/b.txt', 'scritto da me dopo\n')
    await $.command.run(OPEN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS, ...VIEW })
    await ui.press({ key: 'restore' })
    expect((await ui.find({ type: 'Text', text: /ATTENZIONE/ }))).toBeDefined()
    await ui.press({ key: 'cancel' })
    expect(disk.get('/w/b.txt')).toBe('scritto da me dopo\n')
    expect(await ui.find({ key: 'confirm' })).toBeUndefined()
  })

  test('a file the change created is deleted, after a backup', async ($, on) => {
    const { disk } = world(on)
    await turn($, 't1', 'crea', async () => {
      await $.tool.call({ tool: 'Write', file_path: '/w/nuovo.txt', content: 'ciao\n' })
    })
    expect(disk.get('/w/nuovo.txt')).toBe('ciao\n')
    await $.command.run(OPEN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS, ...VIEW })
    expect((await ui.find({ key: 'restore' }))?.text).toContain('Elimina file creato')
    await ui.press({ key: 'restore' })
    await ui.press({ key: 'confirm' })
    expect(disk.has('/w/nuovo.txt')).toBe(false)
    expect([...disk.entries()].some(([path, text]) => path.includes('/backups/') && text === 'ciao\n')).toBe(true)
  })

  test('the whole file goes back to before the turn, across several edits', async ($, on) => {
    const { disk } = world(on)
    disk.set('/w/c.txt', 'a b c\n')
    await turn($, 't1', 'due edit', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/w/c.txt', old_string: 'a', new_string: 'A' })
      await $.tool.call({ tool: 'Edit', file_path: '/w/c.txt', old_string: 'c', new_string: 'C' })
    })
    expect(disk.get('/w/c.txt')).toBe('A b C\n')
    await $.command.run(OPEN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS, ...VIEW })
    await ui.press({ key: 'prev' }) // the first of the two
    await ui.press({ key: 'restore-file' })
    await ui.press({ key: 'confirm' })
    expect(disk.get('/w/c.txt')).toBe('a b c\n')
  })

  test('no restore for a change recorded without its earlier text', async ($, on) => {
    const { disk } = world(on)
    await turn($, 't1', 'edit su file che non c\'era', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/w/fantasma.txt', old_string: 'x', new_string: 'y' })
    })
    await $.command.run(OPEN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS, ...VIEW })
    expect(await ui.find({ key: 'restore' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /Ripristino non disponibile/ }))).toBeDefined()
    expect(disk.has('/w/fantasma.txt')).toBe(false)
  })

  test('the buttons come before the diff, so a short pane never cuts them off', async ($, on) => {
    const { disk } = world(on)
    disk.set('/w/d.txt', 'uno\ndue\n')
    await turn($, 't1', 'x', async () => {
      await $.tool.call({ tool: 'Edit', file_path: '/w/d.txt', old_string: 'due', new_string: 'DUE' })
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
