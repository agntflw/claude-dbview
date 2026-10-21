import type { Host } from './host'

// Where the engine connects. A URL the person gave (`/db connect`) wins;
// else DATABASE_URL; else psql's own PG* variables and defaults.

const STORE_KEY = 'connection'

export type Connection = {
  /** Variables psql reads, the password among them, so none sits in argv. */
  env: Record<string, string>
  /** What the pane shows: user@host:port/db, never the password. */
  label: string
}

export function parseUrl(url: string): Connection | { error: string } {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return { error: 'That is not a URL. Use postgres://user:password@host:5432/database' }
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return { error: 'The URL must start with postgres:// or postgresql://' }
  }

  const env: Record<string, string> = {}
  const host = decodeURIComponent(parsed.hostname)
  const port = parsed.port
  const user = decodeURIComponent(parsed.username)
  const password = decodeURIComponent(parsed.password)
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (host) env.PGHOST = host
  if (port) env.PGPORT = port
  if (user) env.PGUSER = user
  if (password) env.PGPASSWORD = password
  if (database) env.PGDATABASE = database
  const sslmode = parsed.searchParams.get('sslmode')
  if (sslmode) env.PGSSLMODE = sslmode

  return { env, label: labelOf(env) }
}

function labelOf(env: Record<string, string>): string {
  const user = env.PGUSER ?? 'default user'
  const host = env.PGHOST ?? 'localhost'
  const port = env.PGPORT ?? '5432'
  const database = env.PGDATABASE ?? env.PGUSER ?? 'default'

  return `${user}@${host}:${port}/${database}`
}

export async function resolveConnection(host: Host): Promise<Connection> {
  const stored = await host.store.get(STORE_KEY)
  if (typeof stored === 'string') {
    const parsed = parseUrl(stored)
    if ('env' in parsed) return parsed
  }

  const vars = await host.env()
  if (vars.DATABASE_URL) {
    const parsed = parseUrl(vars.DATABASE_URL)
    if ('env' in parsed) return parsed
  }

  // psql reads PG* and ~/.pgpass from the host by itself; this is the label.
  const shown: Record<string, string> = {}
  if (vars.PGHOST) shown.PGHOST = vars.PGHOST
  if (vars.PGPORT) shown.PGPORT = vars.PGPORT
  const user = vars.PGUSER ?? vars.USER
  if (user) shown.PGUSER = user
  if (vars.PGDATABASE) shown.PGDATABASE = vars.PGDATABASE

  return { env: {}, label: labelOf(shown) }
}

export async function saveUrl(host: Host, url: string): Promise<void> {
  await host.store.set(STORE_KEY, url.trim())
}

export async function forgetUrl(host: Host): Promise<void> {
  await host.store.delete(STORE_KEY)
}
