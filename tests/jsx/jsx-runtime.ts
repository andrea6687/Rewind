/** JSX runtime for `bun test`. The plugin runs inside Claude Code, which provides `h`. */
export function jsx(type: unknown, props: Record<string, unknown> | null, key?: unknown) {
  return { type, key: key ?? null, props: props ?? {} }
}

export const jsxs = jsx
export const jsxDEV = jsx
export const Fragment = 'Fragment'
