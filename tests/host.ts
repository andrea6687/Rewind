// Stand-in for the Claude Code host (`claude-code` and `claude-code/testing`)
// so `bun test` can run the suite in a fresh checkout. Test hooks sit under
// the plugin: the plugin runs first and reaches them with `next`.
import { describe as bunDescribe, expect, test as bunTest } from 'bun:test'

type HookFn = ($: Engine, e: unknown, next: (e: unknown) => Promise<unknown>) => unknown

type Hook = {
  event: string
  matcher?: Record<string, unknown>
  fn: HookFn
  onError?: HookFn
  owner: 'plugin' | 'test'
}

type AtomBox = { id: number; initial: unknown }

type ElementNode = { type: unknown; key?: unknown; props: Record<string, unknown> }

const OPS = new Set([
  'fs.read', 'fs.write', 'fs.list', 'fs.exists',
  'env.get', 'clock.now', 'process.run', 'session.cwd',
  'ui.open', 'ui.close', 'ui.toast', 'command.register',
])

const hooks: Hook[] = []
const atoms: AtomBox[] = []
const values = new Map<number, unknown>()
let nextAtom = 1
let phase: 'plugin' | 'test' = 'test'
let pluginReady: Promise<void> | undefined

export function atom(_key: unknown, initial: unknown) {
  const box: AtomBox = { id: nextAtom++, initial: structuredClone(initial) }
  atoms.push(box)
  values.set(box.id, structuredClone(box.initial))
  return box
}

export async function read(_$: unknown, box: AtomBox) {
  return values.get(box.id)
}

export async function update(_$: unknown, box: AtomBox, next: unknown) {
  const current = values.get(box.id)
  values.set(box.id, typeof next === 'function' ? (next as (value: unknown) => unknown)(current) : next)
}

export function resetAtoms() {
  for (const box of atoms) values.set(box.id, structuredClone(box.initial))
}

function on(event: string, matcherOrHook: unknown, maybeHook?: HookFn) {
  const matcher = typeof matcherOrHook === 'function' ? undefined : matcherOrHook as Record<string, unknown>
  const fn = (typeof matcherOrHook === 'function' ? matcherOrHook : maybeHook) as HookFn
  const hook: Hook = { event, matcher, fn, owner: phase }
  hooks.push(hook)
  return {
    catch(handler: HookFn) {
      hook.onError = handler
      return this
    },
  }
}

function clearTestHooks() {
  for (let i = hooks.length - 1; i >= 0; i--) if (hooks[i]?.owner === 'test') hooks.splice(i, 1)
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function matches(event: unknown, matcher?: Record<string, unknown>): boolean {
  if (!matcher) return true
  if (!isPlain(event)) return false
  for (const [key, expected] of Object.entries(matcher)) {
    const got = event[key]
    if (isPlain(expected)) {
      if (!matches(got, expected)) return false
    } else if (got !== expected) return false
  }
  return true
}

function isElement(node: unknown): node is ElementNode {
  return isPlain(node) && 'type' in node && 'props' in node && isPlain(node.props)
}

function elementKey(node: ElementNode): string | undefined {
  const key = node.key ?? node.props.key
  return key === null || key === undefined ? undefined : String(key)
}

function childrenOf(node: ElementNode): unknown[] {
  const children = node.props.children
  if (children === undefined || children === null || children === false || children === true) return []
  const flat = Array.isArray(children) ? children.flat(Infinity) : [children]
  return flat.filter(child => child !== null && child !== undefined && child !== false && child !== true)
}

function shownText(node: ElementNode): string {
  const bits: string[] = []
  for (const child of childrenOf(node)) {
    if (typeof child === 'string' || typeof child === 'number') bits.push(String(child))
  }
  if (typeof node.props.label === 'string') bits.push(node.props.label)
  if (node.type === 'Code' && typeof node.props.source === 'string') bits.push(node.props.source)
  return bits.join('')
}

function queryMatch(node: ElementNode, query: { type?: string; key?: string; text?: string | RegExp }): boolean {
  if (query.type !== undefined && node.type !== query.type) return false
  if (query.key !== undefined && elementKey(node) !== query.key) return false
  if (query.text !== undefined) {
    const text = shownText(node)
    if (query.text instanceof RegExp) {
      if (!new RegExp(query.text.source, query.text.flags).test(text)) return false
    } else if (!text.includes(query.text)) return false
  }
  return true
}

function walk(node: unknown, visit: (node: ElementNode) => void) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (!isElement(node)) return
  visit(node)
  for (const child of childrenOf(node)) walk(child, visit)
}

function toFound(node: ElementNode) {
  const props: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node.props)) {
    if (key === 'children' || typeof value === 'function') continue
    props[key] = value
  }
  return { type: String(node.type), key: elementKey(node), props, text: shownText(node), children: childrenOf(node) }
}

function keysOf(node: unknown): string[] {
  const keys: string[] = []
  walk(node, el => {
    const key = elementKey(el)
    if (key) keys.push(`${String(el.type)}:${key}`)
  })
  return keys
}

async function dispatch(event: string, input: unknown): Promise<unknown> {
  const chain = hooks.filter(hook => hook.event === event && matches(input, hook.matcher))
  const unwrap = OPS.has(event)
  const run = async (index: number, current: unknown): Promise<unknown> => {
    const hook = chain[index]
    if (!hook) return unwrap ? { value: undefined } : undefined
    const next = (forwarded: unknown) => run(index + 1, forwarded)
    try {
      return await hook.fn($, current, next)
    } catch (err) {
      if (hook.onError) return await hook.onError($, current, next)
      throw err
    }
  }
  const result = await run(0, input)
  if (!unwrap) return result
  if (isPlain(result) && 'deny' in result && result.deny !== undefined) throw new Error(String(result.deny))
  if (isPlain(result) && 'value' in result) return result.value
  return result
}

async function render(target: Record<string, unknown>) {
  const tree = await dispatch('ui.render', {
    plugin: target.plugin,
    component: target.component,
    requestId: target.requestId,
    surface: target.surface,
    props: target.props ?? {},
    viewport: target.viewport,
  })
  if (!isElement(tree)) throw new Error(`ui.render did not return a tree (${String(tree).slice(0, 200)})`)
  return tree
}

async function mount(target: Record<string, unknown>) {
  const findAll = async (query: { type?: string; key?: string; text?: string | RegExp }) => {
    const tree = await render(target)
    const found: ReturnType<typeof toFound>[] = []
    walk(tree, node => { if (queryMatch(node, query)) found.push(toFound(node)) })
    return found
  }
  return {
    surface: target.surface,
    async drawn() { return render(target) },
    async find(query: { type?: string; key?: string; text?: string | RegExp }) {
      return (await findAll(query))[0]
    },
    findAll,
    async press(spec: { key: string }) {
      const tree = await render(target)
      let button: ElementNode | undefined
      walk(tree, node => {
        if (!button && node.type === 'Button' && elementKey(node) === spec.key) button = node
      })
      if (!button) throw new Error(`no button ${spec.key} (have ${keysOf(tree).join(', ')})`)
      const press = button.props.onPress
      if (typeof press === 'function') await press()
    },
    async unmount() {},
  }
}

const $ = {
  fs: {
    read: (path: string) => dispatch('fs.read', { path, as: 'text' }),
    write: (path: string, text: string) => dispatch('fs.write', { path, text }),
    list: (path: string) => dispatch('fs.list', { path }),
    exists: (path: string) => dispatch('fs.exists', { path }),
  },
  env: { get: (name: string) => dispatch('env.get', { name }) },
  clock: { now: () => dispatch('clock.now', {}) },
  session: { cwd: () => dispatch('session.cwd', {}) },
  process: { run: (argv: readonly string[]) => dispatch('process.run', { argv }) },
  command: {
    register: (spec: unknown) => dispatch('command.register', spec),
    run: (event: unknown) => dispatch('command.run', event),
  },
  turn: {
    start: (event: unknown) => dispatch('turn.start', event),
    complete: (event: unknown) => dispatch('turn.complete', event),
  },
  tool: { call: (event: unknown) => dispatch('tool.call', event) },
  ui: {
    open: (args: unknown) => dispatch('ui.open', args),
    close: (args: unknown) => dispatch('ui.close', args),
    toast: (text: string, opts?: { timeoutMs?: number }) => dispatch('ui.toast', { text, timeoutMs: opts?.timeoutMs }),
    resolve: () => ({ Box: 'Box', Text: 'Text', Button: 'Button', Code: 'Code' }),
    mount,
  },
}

type Engine = typeof $

function ensurePlugin() {
  if (!pluginReady) {
    pluginReady = (async () => {
      phase = 'plugin'
      const mod = await import('../hooks/register.tsx')
      mod.register(on)
      phase = 'test'
    })()
  }
  return pluginReady
}

export const hostMock = {
  clock(register: typeof on, options?: { now?: number }) {
    let now = options?.now ?? 0
    register('clock.now', () => ({ value: now }))
    return {
      now: () => now,
      advance: async (ms: number) => { now += ms },
      set: async (ms: number) => { now = ms },
      settle: async () => {},
      sleep: async (ms: number) => { now += ms },
    }
  },
  env(register: typeof on, variables: Readonly<Record<string, string>>) {
    register('env.get', (_$, event) => {
      const name = isPlain(event) ? String(event.name) : ''
      return { value: Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : undefined }
    })
  },
  store(register: typeof on, entries?: Readonly<Record<string, unknown>>) {
    const saved = new Map(Object.entries(entries ?? {}))
    register('store.get', (_$, event) => ({ value: saved.get(isPlain(event) ? String(event.key) : '') }))
    register('store.set', (_$, event) => {
      if (isPlain(event)) saved.set(String(event.key), event.value)
      return { value: undefined }
    })
  },
}

export function describe(name: string, fn: () => void) {
  bunDescribe(name, fn)
}

export function test(name: string, fn: (...args: unknown[]) => unknown) {
  bunTest(name, async () => {
    await ensurePlugin()
    clearTestHooks()
    resetAtoms()
    phase = 'test'
    await fn($, on)
  })
}

export { expect }
