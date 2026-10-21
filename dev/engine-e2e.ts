// The engine against live Postgres, outside Claude Code: runs every request
// through real psql and docker and checks the answers. With --record, also
// writes what they printed to tests/fixtures.ts, which the pane tests replay.
//
//   DATABASE_URL=postgres://postgres:postgres@localhost:5432/shop bun dev/engine-e2e.ts [--record]
//
// Expects the sample database from dev/seed.sql there, and two running
// containers seeded the same way, as a migration test leaves them:
//   mig_before  postgres:16, the seed as is
//   mig_after   the seed plus orders.shipped_at, orders_status_idx and
//               the check total_positive

import { createEngine } from '../hooks/engine/engine'
import type { Host } from '../hooks/engine/host'
import { callKey } from '../tests/call-key'

type Call = { argv: string[]; stdin: string | undefined; stdout: string; stderr: string; exitCode: number }
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
    calls.push({ argv: [...argv], stdin: init.stdin, stdout, stderr, exitCode })

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

const sources = await engine.request({ op: 'sources' })
check('sources answer', sources.ok, sources)
const ids = sources.ok ? sources.value.map(one => one.id) : []
check('sources are the host\'s, then each container', ids.join() === 'env,docker:mig_after,docker:mig_before', ids)
const after = sources.ok ? sources.value.find(one => one.id === 'docker:mig_after') : undefined
check('a container shows its published port', after?.port === '55432' && after.origin === 'docker', after)
check('the host source is named for its database', sources.ok && sources.value[0]?.label === 'shop', sources)

const catalog = await engine.request({ op: 'catalog', source: 'env' })
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

const relation = await engine.request({ op: 'relation', source: 'env', schema: 'sales', name: 'orders' })
check('relation answers', relation.ok, relation)
if (relation.ok) {
  const { columns, constraints, indexes } = relation.value
  check('orders has 5 columns in order', columns.map(c => c.name).join() === 'id,customer_id,total,status,note', columns)
  check('id is the primary key', columns[0]?.isPrimaryKey === true)
  check('customer_id references sales.customer(id)', columns[1]?.references === 'sales.customer(id)', columns[1])
  check('total is numeric(10,2) not null', columns[2]?.type === 'numeric(10,2)' && columns[2]?.notNull === true)
  check('constraints: the key, then the foreign key', constraints.map(k => `${k.name}:${k.kind}`).join() === 'orders_pkey:primary,orders_customer_id_fkey:foreign', constraints)
  check('the foreign key reads as Postgres prints it', constraints[1]?.definition === 'FOREIGN KEY (customer_id) REFERENCES sales.customer(id)', constraints[1])
  check('indexes: orders_pkey UNIQUE btree (id)', indexes.map(i => `${i.name} ${i.definition}`).join() === 'orders_pkey UNIQUE btree (id)', indexes)
  check('customer_id leads to sales.customer', columns[1]?.target?.schema === 'sales' && columns[1]?.target?.name === 'customer', columns[1])
  check('the foreign key leads there too', constraints[1]?.target?.name === 'customer' && constraints[0]?.target === null, constraints)
  check('nothing points at orders', relation.value.referencedBy?.length === 0, relation.value.referencedBy)
}

// The other end of the key: who points at customer, to jump back.
const customer = await engine.request({ op: 'relation', source: 'env', schema: 'sales', name: 'customer' })
check('customer answers', customer.ok, customer)
if (customer.ok) {
  const back = customer.value.referencedBy ?? []
  check(
    'customer is referenced by sales.orders(customer_id)',
    back.length === 1 && back[0]?.constraint === 'orders_customer_id_fkey' && back[0]?.schema === 'sales' && back[0]?.name === 'orders' && back[0]?.columns.join() === 'customer_id',
    back,
  )
}
for (const source of ['docker:mig_after', 'docker:mig_before']) {
  const other = await engine.request({ op: 'relation', source, schema: 'sales', name: 'customer' })
  check(`${source} customer answers`, other.ok && other.value.referencedBy?.length === 1, other)
}

const columns = ['id', 'customer_id', 'total', 'status', 'note']
const preview = await engine.request({ op: 'preview', source: 'env', schema: 'sales', name: 'orders', columns, order: ['id'], limit: 50 })
check('preview answers', preview.ok, preview)
if (preview.ok) {
  check('preview holds 50 rows', preview.value.rows.length === 50, preview.value.rows.length)
  check('row 1 is 1,2,7.30,new,note 1', preview.value.rows[0]?.join() === '1,2,7.30,new,note 1', preview.value.rows[0])
  check('NULL stays null', preview.value.rows[4]?.[4] === null, preview.value.rows[4])
  check('the query reads as typed', preview.value.query === 'SELECT * FROM sales.orders ORDER BY id LIMIT 50;', preview.value.query)
}
const more = await engine.request({ op: 'preview', source: 'env', schema: 'sales', name: 'orders', columns, order: ['id'], limit: 500 })
check('limit 500 reads all 400 rows, in key order', more.ok && more.value.rows.length === 400 && more.value.rows[399]?.[0] === '400', more.ok && more.value.rows.length)

const product = await engine.request({ op: 'preview', source: 'env', schema: 'inventory', name: 'product', columns: ['sku', 'tags', 'meta'], order: [], limit: 50 })
check('arrays and json come back in Postgres text form', product.ok && product.value.rows[0]?.join('|') === 'A-1|{red,small}|{"w": 1}', product)

const ddl = await engine.request({ op: 'ddl', source: 'env', schema: 'sales', name: 'orders' })
const text = ddl.ok ? ddl.value : ''
check('ddl opens with the table\'s sequence', text.startsWith('CREATE SEQUENCE sales.orders_id_seq\n  AS bigint'), text.slice(0, 80))
check('then the table with defaults and named constraints', text.includes("CREATE TABLE sales.orders (\n  id bigint DEFAULT nextval('sales.orders_id_seq'::regclass) NOT NULL,") && text.includes('CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES sales.customer(id)'), text)
check('and ends with OWNED BY', text.endsWith('ALTER SEQUENCE sales.orders_id_seq OWNED BY sales.orders.id;'), text.slice(-80))
const seq = await engine.request({ op: 'ddl', source: 'env', schema: 'sales', name: 'orders_id_seq' })
check('a sequence\'s ddl names its owner', seq.ok && seq.value.startsWith('CREATE SEQUENCE') && seq.value.includes('OWNED BY sales.orders.id'), seq)
const viewDdl = await engine.request({ op: 'ddl', source: 'env', schema: 'sales', name: 'big_orders' })
check('a view\'s ddl is CREATE VIEW', viewDdl.ok && viewDdl.value.startsWith('CREATE VIEW sales.big_orders AS'), viewDdl)

// The two containers a migration test left behind, side by side.
const before = await engine.request({ op: 'relation', source: 'docker:mig_before', schema: 'sales', name: 'orders' })
const migrated = await engine.request({ op: 'relation', source: 'docker:mig_after', schema: 'sales', name: 'orders' })
check('docker relation answers on both', before.ok && migrated.ok, { before, migrated })
if (before.ok && migrated.ok) {
  check('mig_after has shipped_at, mig_before not', migrated.value.columns.some(c => c.name === 'shipped_at') && !before.value.columns.some(c => c.name === 'shipped_at'))
  check('mig_after has the check total_positive', migrated.value.constraints.some(k => k.name === 'total_positive' && k.kind === 'check'), migrated.value.constraints)
  check('mig_after has orders_status_idx btree (status)', migrated.value.indexes.some(i => i.name === 'orders_status_idx' && i.definition === 'btree (status)'), migrated.value.indexes)
}
for (const source of ['docker:mig_after', 'docker:mig_before']) {
  const dockerCatalog = await engine.request({ op: 'catalog', source })
  check(`${source} catalog answers`, dockerCatalog.ok && dockerCatalog.value.database === 'shop', dockerCatalog)
}
const dockerRows = await engine.request({ op: 'preview', source: 'docker:mig_after', schema: 'sales', name: 'orders', columns: [...columns, 'shipped_at'], order: ['id'], limit: 50 })
check('docker preview reads 50 rows', dockerRows.ok && dockerRows.value.rows.length === 50, dockerRows)
const gone = await engine.request({ op: 'catalog', source: 'docker:not_running' })
check('a stopped container is one plain line', !gone.ok && gone.error === 'The container not_running is not running.', gone)

const write = await engine.request({ op: 'preview', source: 'env', schema: 'sales', name: 'orders; drop table sales.orders', columns: ['id'], order: [], limit: 1 })
check('a hostile name is an identifier, not SQL', !write.ok && write.error.includes('does not exist'), write)

store.set('connections', { bad: 'postgres://postgres:wrong@localhost:5432/shop' })
const denied = await engine.request({ op: 'catalog', source: 'saved:bad' })
check('a bad password is one plain line', !denied.ok && denied.error === 'password authentication failed for user "postgres"', denied)
check('the password is not in any argv', calls.every(call => !call.argv.join(' ').includes('wrong') && !call.argv.join(' ').includes(':postgres@')))
store.delete('connections')

store.set('connection', 'postgres://postgres:postgres@localhost:5432/shop')
const migratedSources = await engine.request({ op: 'sources' })
check('a 0.1 saved URL comes back as a named source', migratedSources.ok && migratedSources.value[0]?.id === 'saved:shop' && store.get('connection') === undefined, migratedSources)
store.delete('connections')

if (process.argv.includes('--record')) {
  const kept = calls.filter(call => call.exitCode === 0 && !call.argv.includes('--version'))
  const fixture = Object.fromEntries(kept.map(call => [callKey(call.argv, call.stdin), call.argv[1] === 'inspect' ? trimInspect(call.stdout) : call.stdout]))
  await Bun.write(
    new URL('../tests/fixtures.ts', import.meta.url),
    `// Recorded from live Postgres 16 and Docker by dev/engine-e2e.ts --record. Do not edit.\n\nexport const RECORDED: Record<string, string> = ${JSON.stringify(fixture, null, 2)}\n`,
  )
  console.log(`recorded ${Object.keys(fixture).length} answers to tests/fixtures.ts`)
}

/** What discovery reads of `docker inspect`, and nothing else: no password, no addresses. */
function trimInspect(stdout: string): string {
  type Inspect = { Name?: string; Config?: { Image?: string; Env?: string[] }; NetworkSettings?: { Ports?: unknown } }
  const kept = (JSON.parse(stdout) as Inspect[]).map(one => ({
    Name: one.Name,
    Config: { Image: one.Config?.Image, Env: (one.Config?.Env ?? []).filter(pair => /^POSTGRES_(USER|DB)=/.test(pair)) },
    NetworkSettings: { Ports: one.NetworkSettings?.Ports },
  }))

  return JSON.stringify(kept)
}

console.log(failures === 0 ? 'all engine checks passed' : `${failures} engine check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
