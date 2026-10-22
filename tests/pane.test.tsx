import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { scrolled, shouldLift } from '../hooks/client/pane'
import type { PaneLayout } from '../hooks/client/pane'
import { EMPTY_VIEW } from '../hooks/client/state'
import { DARK, LIGHT, SYSTEM, TERMINAL } from '../hooks/client/theme'
import { callKey } from './call-key'
import { RECORDED } from './fixtures'

// The whole slice through the engine's own `$`: /db runs the engine, whose
// psql and docker calls are answered with what a live Postgres 16 and two
// migration-test containers printed (tests/fixtures.ts, recorded by
// dev/engine-e2e.ts), and the pane is drawn and pressed on every surface.

const HOST_URL = 'postgres://postgres:postgres@localhost:5432/shop'
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
type Surface = (typeof SURFACES)[number]

const pane = <S extends Surface>(surface: S, bodyColumns: number, bodyRows = 80) =>
  ({
    plugin: 'dbview',
    surface,
    component: 'Pane',
    requestId: 'dbview',
    props: {
      title: 'Database',
      isFocused: true,
      bodyColumns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows },
      view: {},
    },
  }) as const

const answer = (exitCode: number, stdout: string, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

/** What the recording holds for this call; `--version` finds psql and docker. */
function replay(argv: readonly string[], stdin: string | undefined) {
  if (argv.includes('--version')) return answer(0, `${argv[0]} 1.0\n`)
  const recorded = RECORDED[callKey(argv, stdin)]
  if (recorded !== undefined) return answer(0, recorded)
  // The limit steps through 100 on its way to 500; the recording has 50 and 500.
  const stepped = stdin && RECORDED[callKey(argv, stdin.replace(/limit 100\b/g, 'limit 500'))]
  if (stepped) return answer(0, stepped)

  return answer(3, '', `ERROR:  no recording for ${callKey(argv, stdin)}\n`)
}

const run = (args: string) =>
  ({ command: 'db', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } }) as never

type On = Parameters<TestBody>[1]

function host(on: On, env: Record<string, string>, answerer = replay) {
  const argvs: string[][] = []
  const copied: string[] = []
  mock.store(on)
  mock.env(on, { USER: 'eduard', ...env })
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'db' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.copy', (_, e) => {
    copied.push(e.text)

    return { value: { isCopied: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    argvs.push([...e.argv])

    return answerer(e.argv, e.init?.stdin)
  })

  return { argvs, copied }
}

test('every database shows as a root of the tree, like an IDE explorer', async ($, on) => {
  host(on, { DATABASE_URL: HOST_URL })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const opened = await $.command.run(run(''))
  expect(opened.text).toBe('Database view opened on 3 databases: shop, mig_after, mig_before.')

  for (const surface of SURFACES) {
    for (const width of [120, 60]) {
      const ui = await $.ui.mount(pane(surface, width))
      // The host's database opens first, on its schemas and tables; the
      // containers wait folded, each with its port.
      expect(await ui.find({ type: 'Button', key: 'c:env' })).toBeDefined()
      expect(await ui.find({ type: 'Button', key: 'c:docker:mig_after' })).toBeDefined()
      expect(await ui.find({ type: 'Button', key: 'c:docker:mig_before' })).toBeDefined()
      expect(await ui.find({ text: ':55432 · docker' })).toBeDefined()
      expect(await ui.find({ type: 'Button', key: 'r:env|sales.orders' })).toBeDefined()
      expect(await ui.find({ type: 'Button', key: 'r:docker:mig_after|sales.orders' })).toBeUndefined()
      // The switcher names where the one in front lives.
      expect(await ui.find({ text: /^localhost:5432 · PG 16$/ })).toBeDefined()
      const picker = await ui.find({ type: 'Select', key: 'source' })
      if (surface === 'mobile') expect(picker).toBeUndefined()
      else expect((picker?.props.options as { value: string }[]).map(one => one.value)).toEqual(['env', 'docker:mig_after', 'docker:mig_before'])
      await ui.unmount()
    }
  }
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`a table opens on rows, columns with constraints, and DDL (${surface})`, async ($, on) => {
    const { copied } = host(on, { DATABASE_URL: HOST_URL })
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run(run(''))
    const ui = await $.ui.mount(pane(surface, 140))

    // Rows: the first 50 by key, the query as typed, NULL shown as NULL.
    await ui.press({ key: 'r:env|sales.orders' })
    expect(await ui.find({ text: '400 rows · showing 50' })).toBeDefined()
    expect(await ui.find({ text: 'SELECT * FROM sales.orders ORDER BY id LIMIT 50;' })).toBeDefined()
    expect(await ui.find({ text: /^7\.30$/ })).toBeDefined()
    expect(await ui.find({ text: /^NULL$/ })).toBeDefined()

    // The limit: 500 reads all 400.
    await ui.press({ key: 'limit-more' })
    await ui.press({ key: 'limit-more' })
    expect(await ui.find({ text: /^500$/ })).toBeDefined()
    expect(await ui.find({ text: '400 rows · showing 400' })).toBeDefined()
    expect(await ui.find({ text: 'SELECT * FROM sales.orders ORDER BY id LIMIT 500;' })).toBeDefined()

    // Columns: keys and references, defaults, constraints and indexes.
    await ui.press({ key: 'tab-columns' })
    expect(await ui.find({ text: '5 columns · 2 constraints' })).toBeDefined()
    expect(await ui.find({ text: 'primary key' })).toBeDefined()
    expect(await ui.find({ text: '→ sales.customer(id)' })).toBeDefined()
    expect(await ui.find({ text: "nextval('sales.orders_id_seq'::regclass)" })).toBeDefined()
    expect(await ui.find({ text: 'orders_customer_id_fkey' })).toBeDefined()
    expect(await ui.find({ text: 'FOREIGN KEY (customer_id) → sales.customer(id)' })).toBeDefined()
    expect(await ui.find({ text: 'customer_id, total' })).toBeDefined()
    expect(await ui.find({ text: 'UNIQUE btree (id)' })).toBeDefined()

    // DDL: sequence, table, OWNED BY, numbered, and Copy takes it all.
    await ui.press({ key: 'tab-ddl' })
    const code = await ui.find({ type: 'Code' })
    expect(code?.props.source).toMatch(/^CREATE SEQUENCE sales\.orders_id_seq\n/)
    expect(code?.props.source).toMatch(/ALTER SEQUENCE sales\.orders_id_seq OWNED BY sales\.orders\.id;$/)
    expect(code?.props.startLine).toBe(1)
    // The desktop's code block copies by itself; the terminal has a Copy.
    if (surface === 'terminal') {
      await ui.press({ key: 'copy' })
      expect(copied).toEqual([code?.props.source])
    } else {
      expect(await ui.find({ type: 'Button', key: 'copy' })).toBeUndefined()
    }
    await ui.unmount()
  })
}

test('two migration containers open side by side', async ($, on) => {
  host(on, { DATABASE_URL: HOST_URL })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(run(''))
  const ui = await $.ui.mount(pane('desktop', 140))

  await ui.press({ key: 'c:docker:mig_after' })
  await ui.press({ key: 'r:docker:mig_after|sales.orders' })
  expect(await ui.find({ text: 'SELECT * FROM sales.orders ORDER BY id LIMIT 50;' })).toBeDefined()
  expect((await ui.findAll({ text: /^shipped_at$/ })).length).toBeGreaterThan(0)
  await ui.press({ key: 'tab-columns' })
  expect(await ui.find({ text: 'total_positive' })).toBeDefined()
  expect(await ui.find({ text: 'orders_status_idx' })).toBeDefined()

  // The same table before the migration: no new check, no new index.
  await ui.press({ key: 'c:docker:mig_before' })
  await ui.press({ key: 'r:docker:mig_before|sales.orders' })
  expect(await ui.find({ text: /mig_before$/ })).toBeDefined()
  expect(await ui.find({ text: 'total_positive' })).toBeUndefined()
  expect(await ui.find({ text: 'orders_status_idx' })).toBeUndefined()
  // Both stay in the tree.
  expect(await ui.find({ type: 'Button', key: 'r:docker:mig_after|sales.orders' })).toBeDefined()
  await ui.unmount()
})

test('the filter narrows the tree where the surface has a field', async ($, on) => {
  host(on, { DATABASE_URL: HOST_URL })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(run(''))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(pane(surface, 120))
    await ui.input({ key: 'filter', text: 'cust', kind: 'change' })
    expect(await ui.find({ type: 'Button', key: 'r:env|sales.customer' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'r:env|sales.orders' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 's:env|public' })).toBeUndefined()
    await ui.input({ key: 'filter', text: '', kind: 'change' })
    expect(await ui.find({ type: 'Button', key: 'r:env|sales.orders' })).toBeDefined()
    await ui.unmount()
  }
})

test('a saved connection that is refused says so in one line, and is forgotten by name', async ($, on) => {
  const { argvs } = host(on, {}, argv =>
    argv[0] === 'docker'
      ? answer(127, '', 'docker: not found\n')
      : argv.includes('--version')
        ? answer(0, 'psql (PostgreSQL) 16\n')
        : answer(2, '', 'psql: error: connection to server at "localhost" (127.0.0.1), port 5432 failed: FATAL:  password authentication failed for user "postgres"\n'),
  )
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const reply = await $.command.run(run('connect postgres://postgres:secret@localhost:5432/shop'))
  expect(reply.text).toBe(
    'Saved shop (postgres@localhost:5432/shop), but it did not answer: password authentication failed for user "postgres"',
  )
  expect(argvs.some(argv => argv.join(' ').includes('secret'))).toBe(false)

  const ui = await $.ui.mount(pane('desktop', 120))
  expect(await ui.find({ type: 'Button', key: 'c:saved:shop' })).toBeDefined()
  expect(await ui.find({ text: 'password authentication failed for user "postgres"' })).toBeDefined()
  await ui.unmount()

  expect((await $.command.run(run('forget nope'))).text).toMatch(/^No saved connection is named nope\./)
  expect((await $.command.run(run('forget shop'))).text).toBe('Forgot shop.')
})

test('on the terminal the tree and the open object scroll on their own, down and across', async ($, on) => {
  host(on, { DATABASE_URL: HOST_URL })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(run(''))
  const ui = await $.ui.mount(pane('terminal', 44, 36))

  // Narrow: stacked, the rows of orders in a window under the tree.
  await ui.press({ key: 'r:env|sales.orders' })
  expect(await ui.find({ text: 'SELECT * FROM sales.orders ORDER BY id LIMIT 50;' })).toBeDefined()
  expect(await ui.find({ text: /ms · read-only/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'detail-up' })).toBeDefined()
  for (let step = 0; step < 60; step++) await ui.press({ key: 'detail-down' })
  expect(await ui.find({ text: /ms · read-only/ })).toBeDefined()
  expect(await ui.find({ text: 'SELECT * FROM sales.orders ORDER BY id LIMIT 50;' })).toBeUndefined()

  // Wider than the room: a bar across, and its steps move the grid.
  expect(await ui.find({ type: 'Button', key: 'detail-right' })).toBeDefined()
  await ui.press({ key: 'detail-right' })
  const moved = (await ui.findAll({ type: 'Box' })).some(box => typeof box.props.marginLeft === 'number' && box.props.marginLeft < 0)
  expect(moved).toBe(true)

  // Another tab starts at the top left again.
  await ui.press({ key: 'tab-columns' })
  expect(await ui.find({ text: 'Name' })).toBeDefined()
  await ui.unmount()
})

test('on the desktop the panels stand whole and the body scrolls as one', async ($, on) => {
  host(on, { DATABASE_URL: HOST_URL })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(run(''))
  const ui = await $.ui.mount(pane('desktop', 44, 36))

  // Stacked: the object opens under its own row, the rest of the tree after
  // it; every row of orders, and no bar down.
  await ui.press({ key: 'r:env|sales.orders' })
  expect(await ui.find({ text: 'SELECT * FROM sales.orders ORDER BY id LIMIT 50;' })).toBeDefined()
  expect(await ui.find({ text: /ms · read-only/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'detail-down' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'tree-down' })).toBeUndefined()
  const order = (await ui.findAll({})).map(one => one.props.key).filter(key => key === 'r:env|sales.orders' || key === 'detail' || key === 'f:env|sales|views')
  expect(order).toEqual(['r:env|sales.orders', 'detail', 'f:env|sales|views'])

  // Tree rows are filled, never bordered, so they keep to one row each; the
  // chevron folds with a press, in the line icon's thin glyph.
  const rowBoxes = (await ui.findAll({ type: 'Box' })).filter(box => String(box.props.key ?? '').endsWith(':fill'))
  expect(rowBoxes.length).toBeGreaterThan(5)
  expect(rowBoxes.every(box => box.props.borderStyle === undefined)).toBe(true)
  expect(rowBoxes.filter(box => box.props.backgroundColor !== undefined).map(box => box.props.key)).toEqual(['r:env|sales.orders:fill'])
  expect((await ui.find({ type: 'Button', key: 's:env|sales:fold' }))?.text).toBe('⌄')
  await ui.press({ key: 's:env|sales:fold' })
  expect((await ui.find({ type: 'Button', key: 's:env|sales:fold' }))?.text).toBe('›')
  await ui.press({ key: 's:env|sales:fold' })

  // Across is still the pane's own, its bar over the grid.
  await ui.press({ key: 'detail-right' })
  const moved = (await ui.findAll({ type: 'Box' })).some(box => typeof box.props.marginLeft === 'number' && box.props.marginLeft < 0)
  expect(moved).toBe(true)
  await ui.unmount()

  // Wide: an object opens at the row the window shows, beside the tree.
  const wide = await $.ui.mount({ ...pane('desktop', 140, 30), props: { ...pane('desktop', 140, 30).props, scroll: { offset: 7, bodyRows: 30 } } })
  await wide.press({ key: 'r:env|sales.customer' })
  const detail = (await wide.findAll({ type: 'Box' })).find(box => box.props.key === 'detail')
  expect(detail?.props.marginTop).toBe(7)
  await wide.unmount()
})

test('on the desktop the open table comes to the top of the window once the wheel rests', () => {
  // Opened at row 30, the tree scrolled back to the top: room above it, always.
  expect(shouldLift(30, 0, 20, 40, 'tree')).toBe(true)
  expect(shouldLift(30, 0, 20, 40, 'object')).toBe(true)
  expect(shouldLift(30, 0, 20, 40)).toBe(true)
  // Scrolled on past it: over the tree it follows, over the table it is read down.
  expect(shouldLift(0, 12, 20, 40, 'tree')).toBe(true)
  expect(shouldLift(0, 12, 20, 40, 'object')).toBe(false)
  // No pointer said: it follows once less than half the window shows it.
  expect(shouldLift(0, 12, 20, 40)).toBe(false)
  expect(shouldLift(0, 35, 20, 40)).toBe(true)
  expect(shouldLift(7, 7, 20, 40, 'tree')).toBe(false)
})

test('a wheel moves the part under the pointer', () => {
  const layout: PaneLayout = {
    isWide: true,
    isFlow: false,
    split: 40,
    across: 50,
    tree: { max: 30, page: 40 },
    detail: { max: 100, page: 40 },
    left: { max: 60, page: 70 },
    objectRows: 60,
    for: 'env|sales.orders:rows',
  }
  const view = { ...EMPTY_VIEW, scroll: { tree: 0, detail: 0, left: 0, for: 'env|sales.orders:rows' } }

  expect(scrolled(view, layout, 1, { column: 10, row: 5 })).toMatchObject({ tree: 3, detail: 0, left: 0 })
  expect(scrolled(view, layout, 2, { column: 60, row: 5 })).toMatchObject({ tree: 0, detail: 6, left: 0 })
  expect(scrolled(view, layout, 1, { column: 60, row: 51 })).toMatchObject({ detail: 0, left: 4 })
  expect(scrolled(view, layout, -1, { column: 60, row: 5 })).toMatchObject({ detail: 0 })
  expect(scrolled(view, layout, 500, { column: 10, row: 5 })).toMatchObject({ tree: 30 })
  // Keys with no pointer move the open object; another object starts at the top.
  expect(scrolled(view, layout, 40)).toMatchObject({ detail: 40 })
  const other = { ...view, scroll: { tree: 4, detail: 9, left: 9, for: 'env|sales.customer:rows' } }
  expect(scrolled(other, layout, 1)).toMatchObject({ tree: 4, detail: 1, left: 0, for: 'env|sales.orders:rows' })
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`a foreign key is a link: one press opens the table it points at, Back returns (${surface})`, async ($, on) => {
    host(on, { DATABASE_URL: HOST_URL })
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run(run(''))
    const ui = await $.ui.mount(pane(surface, 140))
    const heading = async () => (await ui.findAll({ type: 'Text' })).find(one => one.props.size === 'heading')?.text

    // From the Columns tab's reference: customer opens on Columns, Back names orders.
    await ui.press({ key: 'r:env|sales.orders' })
    await ui.press({ key: 'tab-columns' })
    expect(await ui.find({ type: 'Button', key: 'back' })).toBeUndefined()
    await ui.press({ key: 'fk-customer_id' })
    expect(await heading()).toBe('customer')
    expect(await ui.find({ text: '4 columns · 2 constraints' })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'back' }))?.text).toBe('← orders')

    // The other end: customer lists who points at it, a press away.
    expect(await ui.find({ text: /Referenced by$/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'ref-by-sales.orders.orders_customer_id_fkey' })).toBeDefined()

    await ui.press({ key: 'back' })
    expect(await heading()).toBe('orders')
    expect(await ui.find({ type: 'Button', key: 'back' })).toBeUndefined()

    // From the constraint, then back along the key from customer: a trail of two.
    await ui.press({ key: 'fk-def-orders_customer_id_fkey' })
    expect(await heading()).toBe('customer')
    await ui.press({ key: 'ref-by-sales.orders.orders_customer_id_fkey' })
    expect(await heading()).toBe('orders')
    expect((await ui.find({ type: 'Button', key: 'back' }))?.text).toBe('← customer')
    await ui.press({ key: 'back' })
    await ui.press({ key: 'back' })
    expect(await heading()).toBe('orders')
    expect(await ui.find({ type: 'Button', key: 'back' })).toBeUndefined()

    // In the tree, the key column looks as any other (its type) and follows it too.
    expect(await ui.find({ text: '→ customer' })).toBeUndefined()
    await ui.press({ key: 'r:env|sales.orders:customer_id' })
    expect(await heading()).toBe('customer')
    // Unfolded in the tree: its columns show, created_at in the tree's short type.
    expect(await ui.find({ type: 'Button', key: 'r:env|sales.customer' })).toBeDefined()
    expect(await ui.find({ text: 'timestamptz' })).toBeDefined()

    // A press in the tree starts afresh: no Back.
    await ui.press({ key: 'r:env|sales.orders' })
    expect(await ui.find({ type: 'Button', key: 'back' })).toBeUndefined()
    await ui.unmount()
  })
}

test('a jump unfolds the tree to its target and brings it into view', async ($, on) => {
  host(on, { DATABASE_URL: HOST_URL })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(run(''))
  const ui = await $.ui.mount(pane('terminal', 44, 30))

  // A filter that hides customer gives way to the jump.
  await ui.press({ key: 'r:env|sales.orders' })
  await ui.press({ key: 'tab-columns' })
  await ui.input({ key: 'filter', text: 'orders', kind: 'change' })
  expect(await ui.find({ type: 'Button', key: 'r:env|sales.customer' })).toBeUndefined()
  await ui.press({ key: 'fk-customer_id' })
  expect(await ui.find({ type: 'Button', key: 'r:env|sales.customer' })).toBeDefined()
  expect(await ui.find({ text: 'timestamptz' })).toBeDefined()

  // The tree scrolled away from orders: Back brings it into view again.
  for (let step = 0; step < 30; step++) await ui.press({ key: 'tree-down' })
  expect(await ui.find({ type: 'Button', key: 'r:env|sales.orders' })).toBeUndefined()
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Button', key: 'r:env|sales.orders' })).toBeDefined()
  await ui.unmount()
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`a foreign key link looks exactly like the text around it (${surface})`, async ($, on) => {
    host(on, { DATABASE_URL: HOST_URL })
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run(run(''))
    const ui = await $.ui.mount(pane(surface, 140))
    await ui.press({ key: 'r:env|sales.orders' })
    await ui.press({ key: 'tab-columns' })

    // A plain Button holding the very Text a plain line draws: no hover, no colour of its own.
    const constraint = await ui.find({ type: 'Button', key: 'fk-def-orders_customer_id_fkey' })
    const neighbour = (await ui.findAll({ type: 'Text' })).find(one => one.text === 'PRIMARY KEY (id)')
    expect(constraint?.props).toEqual({ key: 'fk-def-orders_customer_id_fkey', label: 'FOREIGN KEY (customer_id) → sales.customer(id)', plain: true })
    expect((constraint?.children[0] as { props: unknown }).props).toEqual(neighbour?.props)

    // The Columns tab's reference keeps the style it had before it was a link.
    const reference = await ui.find({ type: 'Button', key: 'fk-customer_id' })
    expect(reference?.props.hover).toBeUndefined()
    const link = (surface === 'desktop' ? SYSTEM : TERMINAL).link
    expect((reference?.children[0] as { props: unknown }).props).toEqual({ mono: true, size: 'footnote', color: link, wrap: 'truncate-end' })

    // The tree's key column shows its type, as every column does.
    expect(await ui.find({ type: 'Button', key: 'r:env|sales.orders:customer_id' })).toBeDefined()
    expect(await ui.find({ text: /^→ customer$/ })).toBeUndefined()
    await ui.unmount()
  })
}

// Themes. The surfaces do not say whether the app is light or dark, so
// `system` leaves the text to the surface and lays faint layers where the
// others paint fills; `light` and `dark` paint every word themselves, so no
// word lands in the app's colour on a panel of the other theme.

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

/** Every word drawn in the surface's own colour: no colour or dim of its own, nor of a Text or Button around it. */
function uncoloured(node: unknown, isInked = false, out: string[] = []): string[] {
  if (typeof node === 'string') {
    if (!isInked && node.trim() !== '') out.push(node)

    return out
  }
  if (Array.isArray(node)) {
    for (const one of node) uncoloured(one, isInked, out)

    return out
  }
  const element = node as Drawn
  if (!element || typeof element !== 'object') return out
  const props = element.props ?? {}
  const isText = element.type === 'Text' || element.type === 'Button'
  const inked = isInked || (isText && (props.color !== undefined || props.dimColor === true))
  if (element.type === 'Button' && typeof props.label === 'string' && !element.children?.length && !inked) out.push(props.label)
  for (const child of element.children ?? []) uncoloured(child, inked, out)

  return out
}

/** Every value a prop named `name` takes anywhere in the tree. */
function valuesOf(node: unknown, name: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const one of node) valuesOf(one, name, out)

    return out
  }
  const element = node as Drawn
  if (!element || typeof element !== 'object') return out
  if (element.props && name in element.props) out.push(element.props[name])
  if (element.props?.hover && typeof element.props.hover === 'object') valuesOf({ props: element.props.hover }, name, out)
  for (const child of element.children ?? []) valuesOf(child, name, out)

  return out
}

const TABS = ['tab-rows', 'tab-columns', 'tab-ddl'] as const

test('/db theme says which theme the pane is in, keeps a new one, and refuses a word it does not know', async ($, on) => {
  host(on, { DATABASE_URL: HOST_URL })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect((await $.command.run(run('theme'))).text).toBe(
    'The database view follows the app’s light or dark theme (system). Use /db theme system, light or dark.',
  )
  expect((await $.command.run(run('theme light'))).text).toBe('The database view now stays light.')
  expect((await $.command.run(run('theme sepia'))).text).toBe('The database view stays light (light). Use /db theme system, light or dark.')
  expect((await $.command.run(run('theme dark'))).text).toBe('The database view now stays dark.')
  expect((await $.command.run(run('theme system'))).text).toBe('The database view now follows the app’s light or dark theme.')
})

for (const mode of ['light', 'dark'] as const) {
  test(`the ${mode} theme paints every word and panel itself, on every tab`, async ($, on) => {
    const palette = mode === 'light' ? LIGHT : DARK
    const other = mode === 'light' ? DARK : LIGHT
    host(on, { DATABASE_URL: HOST_URL })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run(run(''))
    await $.command.run(run(`theme ${mode}`))

    for (const width of [140, 60]) {
      const ui = await $.ui.mount(pane('desktop', width))
      await ui.press({ key: 'r:env|sales.orders' })
      for (const tab of TABS) {
        await ui.press({ key: tab })
        const tree = await ui.drawn()
        expect(uncoloured(tree)).toEqual([])
        const fills = valuesOf(tree, 'backgroundColor').filter(one => one !== undefined)
        expect(fills).toContain(palette.panel)
        expect(fills).toContain(palette.pill)
        // Nothing of the other theme is left anywhere, the icons included.
        const json = JSON.stringify(tree)
        for (const colour of [other.panel, other.well, other.pill, other.border, other.muted]) expect(json).not.toContain(colour)
        expect(valuesOf(tree, 'color')).toContain(palette.text)
        expect(valuesOf(tree, 'color')).not.toContain(other.text)
      }
      await ui.unmount()
    }
  })
}

test('the system theme leaves the text to the app and lays only faint layers that sit on light and dark', async ($, on) => {
  host(on, { DATABASE_URL: HOST_URL })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(run(''))
  const ui = await $.ui.mount(pane('desktop', 140))
  await ui.press({ key: 'r:env|sales.orders' })

  for (const tab of TABS) {
    await ui.press({ key: tab })
    const tree = await ui.drawn()
    // No text colour of either theme: the body text is the app's.
    expect(uncoloured(tree).length).toBeGreaterThan(0)
    const inks = valuesOf(tree, 'color')
    for (const colour of [DARK.text, DARK.column, LIGHT.text, LIGHT.column]) expect(inks).not.toContain(colour)
    // Fills and edges are see-through layers, or nothing.
    for (const name of ['backgroundColor', 'borderColor']) {
      for (const one of valuesOf(tree, name)) if (one !== undefined) expect(String(one)).toMatch(/^rgba\(|^transparent$/)
    }
    // A tile is its icon's colour, faint.
    const tiles = (await ui.findAll({ type: 'Svg' })).map(one => String(one.props.source)).filter(one => one.includes('<rect'))
    expect(tiles.length).toBeGreaterThan(0)
    for (const one of tiles) expect(one).toContain(`fill-opacity="${SYSTEM.tileOpacity}"`)
  }
  await ui.unmount()
})

test('the terminal keeps its own colours whatever the theme', async ($, on) => {
  host(on, { DATABASE_URL: HOST_URL })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(run(''))
  const ui = await $.ui.mount(pane('terminal', 140))
  await ui.press({ key: 'r:env|sales.orders' })
  await ui.press({ key: 'tab-columns' })
  const drawings: string[] = []

  for (const mode of ['system', 'light', 'dark'] as const) {
    await $.command.run(run(`theme ${mode}`))
    drawings.push(JSON.stringify(await ui.drawn()))
  }
  await ui.unmount()
  expect(drawings[1]).toBe(drawings[0])
  expect(drawings[2]).toBe(drawings[0])
})
