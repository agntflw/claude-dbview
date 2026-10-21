import { expect, mock, test } from 'claude-code/testing'

import { PSQL } from './fixtures'

// The whole slice through the engine's own `$`: /db connect runs the engine,
// whose psql calls are answered with what a live Postgres 16 printed
// (tests/fixtures.ts, recorded by dev/engine-e2e.ts), and the pane is drawn
// and pressed on every surface.

const URL = 'postgres://postgres:secret@localhost:5432/shop'

const pane = <S extends 'terminal' | 'desktop' | 'vscode' | 'mobile'>(surface: S, bodyColumns: number) =>
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
      scroll: { offset: 0, bodyRows: 60 },
      view: {},
    },
  }) as const

function answerPsql(argv: readonly string[], stdin: string | undefined) {
  const ok = (stdout: string) => ({
    value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })
  if (argv.includes('--version')) return ok('psql (PostgreSQL) 16.15\n')
  const vars = argv.filter(arg => arg.includes('=') && !arg.startsWith('ON_ERROR'))
  const head = (stdin ?? '').slice(0, 60).trim()
  const match = PSQL.find(one => one.stdin === head && one.vars.join() === vars.join())
  if (match) return ok(match.stdout)

  return {
    value: {
      exitCode: 3,
      stdout: '',
      stderr: 'psql:<stdin>:1: ERROR:  no fixture for this call\n',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }
}

test('connect, browse the tree, open a table, read its rows and DDL', async ($, on) => {
  const argvs: string[][] = []
  mock.store(on)
  mock.env(on, { USER: 'eduard' })
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'db' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    argvs.push([...e.argv])

    return answerPsql(e.argv, e.init?.stdin)
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const connected = await $.command.run({
    command: 'db',
    args: `connect ${URL}`,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  } as never)
  expect(connected.text).toBe('Connected to postgres@localhost:5432/shop. The database view is open.')
  expect(argvs.some(argv => argv.join(' ').includes('secret'))).toBe(false)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const width of [120, 60]) {
      const ui = await $.ui.mount(pane(surface, width))

      // The tree opens on the schemas and their tables, like a project.
      expect(await ui.find({ type: 'Button', key: 's:sales' })).toBeDefined()
      expect(await ui.find({ type: 'Button', key: 'f:sales:tables' })).toBeDefined()
      expect(await ui.find({ type: 'Button', key: 'r:sales.orders' })).toBeDefined()
      expect(await ui.find({ text: /postgres@localhost:5432\/shop · PG 16\.15/ })).toBeDefined()

      // Opening orders lists its columns under it and shows its first rows.
      await ui.press({ key: 'r:sales.customer' })
      await ui.press({ key: 'r:sales.orders' })
      expect(await ui.find({ text: /^customer_id$/ })).toBeDefined()
      expect(await ui.find({ text: /first 50 rows/ })).toBeDefined()
      expect(await ui.find({ text: /^7\.30$/ })).toBeDefined()
      expect(await ui.find({ text: /^NULL$/ })).toBeDefined()

      // The DDL tab shows the table as SQL.
      await ui.press({ key: 'tab-ddl' })
      const code = await ui.find({ type: 'Code' })
      expect(code?.props.source).toMatch(/^create table sales\.orders \(/)

      // Back to rows; a second press folds the table's columns in the tree
      // and leaves it open on the right.
      await ui.press({ key: 'tab-rows' })
      const inTree = async () => (await ui.findAll({ type: 'Text', text: /^customer_id$/ })).some(one => one.props.wrap === 'truncate-end' && one.props.tabular === undefined)
      expect(await inTree()).toBe(true)
      await ui.press({ key: 'r:sales.orders' })
      expect(await inTree()).toBe(false)
      expect(await ui.find({ text: /^7\.30$/ })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('the filter narrows the tree where the surface has a field', async ($, on) => {
  mock.store(on)
  mock.env(on, { USER: 'eduard' })
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'db' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => answerPsql(e.argv, e.init?.stdin))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({
    command: 'db',
    args: `connect ${URL}`,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(pane(surface, 120))
    await ui.input({ key: 'filter', text: 'cust', kind: 'change' })
    expect(await ui.find({ type: 'Button', key: 'r:sales.customer' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'r:sales.orders' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 's:public' })).toBeUndefined()
    await ui.input({ key: 'filter', text: '', kind: 'change' })
    expect(await ui.find({ type: 'Button', key: 'r:sales.orders' })).toBeDefined()
    await ui.unmount()
  }
})

test('a refused connection says so in one line, in the pane and the reply', async ($, on) => {
  mock.store(on)
  mock.env(on, { USER: 'eduard' })
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'db' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) =>
    e.argv.includes('--version')
      ? answerPsql(e.argv, undefined)
      : {
          value: {
            exitCode: 2,
            stdout: '',
            stderr:
              'psql: error: connection to server at "localhost" (127.0.0.1), port 5432 failed: FATAL:  password authentication failed for user "postgres"\n',
            isStdoutTruncated: false,
            isStderrTruncated: false,
          },
        },
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const reply = await $.command.run({
    command: 'db',
    args: `connect ${URL}`,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  } as never)
  expect(reply.text).toBe(
    'Could not connect to postgres@localhost:5432/shop: password authentication failed for user "postgres"',
  )

  const ui = await $.ui.mount(pane('desktop', 120))
  expect(await ui.find({ text: 'password authentication failed for user "postgres"' })).toBeDefined()
  await ui.unmount()
})
