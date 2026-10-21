import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { callKey } from './call-key'
import { RECORDED } from './fixtures'

// The whole slice through the engine's own `$`: /db runs the engine, whose
// psql and docker calls are answered with what a live Postgres 16 and two
// migration-test containers printed (tests/fixtures.ts, recorded by
// dev/engine-e2e.ts), and the pane is drawn and pressed on every surface.

const HOST_URL = 'postgres://postgres:postgres@localhost:5432/shop'
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
type Surface = (typeof SURFACES)[number]

const pane = <S extends Surface>(surface: S, bodyColumns: number) =>
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
      scroll: { offset: 0, bodyRows: 80 },
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
    await ui.press({ key: 'limit-500' })
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
    await ui.press({ key: 'copy' })
    expect(copied).toEqual([code?.props.source])
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
