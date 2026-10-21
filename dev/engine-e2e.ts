// The engine against a live Postgres, outside Claude Code: runs every request
// through real psql and checks the answers. With --record, also writes what
// psql printed to tests/fixtures.ts, which the pane tests replay.
//
//   DATABASE_URL=postgres://postgres:postgres@localhost:5432/shop bun dev/engine-e2e.ts [--record]
//
// Expects the sample database from dev/seed.sql.

import { createEngine } from '../hooks/engine/engine'
import type { Host } from '../hooks/engine/host'

type Call = { argv: string[]; stdin: string; stdout: string; stderr: string; exitCode: number }
const calls: Call[] = []
const store = new Map<string, unknown>()

const host: Host = {
  run: async (argv, init) => {
    const child = Bun.spawn(argv as string[], {
      env: { ...process.env, ...init.env },
      stdin: init.stdin === undefined ? 'ignore' : new TextEncoder().encode(init.stdin),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (init.stdin !== undefined) calls.push({ argv: [...argv], stdin: init.stdin, stdout, stderr, exitCode })

    return { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false }
  },
  now: async () => performance.now(),
  store: {
    get: async key => store.get(key),
    set: async (key, value) => void store.set(key, value),
    delete: async key => void store.delete(key),
  },
  env: async () => ({ DATABASE_URL: process.env.DATABASE_URL }),
}

let failures = 0
function check(what: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}

const engine = createEngine(host, 'psql')

const catalog = await engine.request({ op: 'catalog' })
check('catalog answers', catalog.ok, catalog)
if (catalog.ok) {
  const names = catalog.value.schemas.map(schema => schema.name)
  check('schemas are inventory, public, sales', names.join() === 'inventory,public,sales', names)
  const sales = catalog.value.schemas.find(schema => schema.name === 'sales')
  const kinds = Object.fromEntries((sales?.relations ?? []).map(relation => [relation.name, relation.kind]))
  check('sales holds tables, a view, a matview, sequences', kinds.orders === 'table' && kinds.big_orders === 'view' && kinds.revenue_by_customer === 'matview' && kinds.orders_id_seq === 'sequence', kinds)
  check('sales has order_count(c integer)', sales?.routines.some(r => r.name === 'order_count' && r.args === 'c integer') === true, sales?.routines)
  check('no system schemas', !names.some(name => name.startsWith('pg_') || name === 'information_schema'))
}

const columns = await engine.request({ op: 'columns', schema: 'sales', name: 'orders' })
check('columns answer', columns.ok, columns)
if (columns.ok) {
  check('orders has 5 columns in order', columns.value.map(c => c.name).join() === 'id,customer_id,total,status,note', columns.value)
  check('id is the primary key', columns.value[0]?.isPrimaryKey === true)
  check('customer_id references customer.id', columns.value[1]?.references === 'customer.id', columns.value[1])
  check('total is numeric(10,2) not null', columns.value[2]?.type === 'numeric(10,2)' && columns.value[2]?.notNull === true)
}

const preview = await engine.request({
  op: 'preview',
  schema: 'sales',
  name: 'orders',
  columns: ['id', 'customer_id', 'total', 'status', 'note'],
  limit: 50,
})
check('preview answers', preview.ok, preview)
if (preview.ok) {
  check('preview holds 50 rows', preview.value.rows.length === 50, preview.value.rows.length)
  check('row 1 is 1,2,7.30,new,note 1', preview.value.rows[0]?.join() === '1,2,7.30,new,note 1', preview.value.rows[0])
  check('NULL stays null', preview.value.rows[4]?.[4] === null, preview.value.rows[4])
}

const product = await engine.request({ op: 'preview', schema: 'inventory', name: 'product', columns: ['sku', 'tags', 'meta'], limit: 50 })
check('arrays and json come back in Postgres text form', product.ok && product.value.rows[0]?.join('|') === 'A-1|{red,small}|{"w": 1}', product)

const ddl = await engine.request({ op: 'ddl', schema: 'sales', name: 'orders' })
check('ddl answers create table with keys', ddl.ok && ddl.value.startsWith('create table sales.orders (') && ddl.value.includes('FOREIGN KEY (customer_id) REFERENCES sales.customer(id)'), ddl)

const write = await engine.request({ op: 'preview', schema: 'sales', name: 'orders; drop table sales.orders', columns: ['id'], limit: 1 })
check('a hostile name is an identifier, not SQL', !write.ok && write.error.includes('does not exist'), write)

store.set('connection', 'postgres://postgres:wrong@localhost:5432/shop')
const denied = await engine.request({ op: 'catalog' })
check('a bad password is one plain line', !denied.ok && denied.error === 'password authentication failed for user "postgres"', denied)
check('the password is not in any argv', calls.every(call => !call.argv.join(' ').includes('wrong') && !call.argv.join(' ').includes(':postgres@')))
store.delete('connection')

if (process.argv.includes('--record')) {
  const kept = calls.filter(call => call.exitCode === 0)
  const fixture = kept.map(call => ({ vars: call.argv.filter(arg => arg.includes('=') && !arg.startsWith('ON_ERROR')), stdin: call.stdin.slice(0, 60).trim(), stdout: call.stdout }))
  await Bun.write(
    new URL('../tests/fixtures.ts', import.meta.url),
    `// Recorded from a live Postgres 16 by dev/engine-e2e.ts --record. Do not edit.\n\nexport const PSQL: { vars: string[]; stdin: string; stdout: string }[] = ${JSON.stringify(fixture, null, 2)}\n`,
  )
  console.log(`recorded ${kept.length} psql answers to tests/fixtures.ts`)
}

console.log(failures === 0 ? 'all engine checks passed' : `${failures} engine check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
