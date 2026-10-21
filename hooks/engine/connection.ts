import type { DbSource } from '../../types'
import { discover } from './docker'
import type { DockerTarget } from './docker'
import type { Host } from './host'

// The data sources the pane lists, and how the engine reaches each: saved
// URLs (/db connect), the host's own DATABASE_URL or PG* variables, and the
// Postgres containers Docker is running.

const STORE_KEY = 'connections'
const LEGACY_KEY = 'connection'

/** How the engine reaches one source. */
export type Target =
  | { kind: 'psql'; env: Record<string, string>; label: string }
  | ({ kind: 'docker'; label: string } & DockerTarget)

export function parseUrl(url: string): { env: Record<string, string>; label: string } | { error: string } {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return { error: 'That is not a URL. Use postgres://user:password@host:5432/database' }
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return { error: 'The URL must start with postgres:// or postgresql://' }
  }

  // The password travels in PGPASSWORD, so it is never on a command line.
  const env: Record<string, string> = {}
  const host = decodeURIComponent(parsed.hostname)
  const user = decodeURIComponent(parsed.username)
  const password = decodeURIComponent(parsed.password)
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (host) env.PGHOST = host
  if (parsed.port) env.PGPORT = parsed.port
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

/** The name a URL is saved under when none is given: its database, then its host and port. */
export function nameFor(url: string, taken: readonly string[]): string {
  const parsed = parseUrl(url)
  const env = 'env' in parsed ? parsed.env : {}
  const base = env.PGDATABASE ?? env.PGHOST ?? 'postgres'
  const candidates = [base, `${base}@${env.PGHOST ?? 'localhost'}:${env.PGPORT ?? '5432'}`]
  const free = candidates.find(one => !taken.includes(one))
  if (free) return free
  let n = 2
  while (taken.includes(`${base}-${n}`)) n += 1

  return `${base}-${n}`
}

export async function savedUrls(host: Host): Promise<Record<string, string>> {
  const stored = await host.store.get(STORE_KEY)
  const saved: Record<string, string> = stored && typeof stored === 'object' ? { ...(stored as Record<string, string>) } : {}

  // 0.1 kept one URL under another key.
  const legacy = await host.store.get(LEGACY_KEY)
  if (typeof legacy === 'string') {
    saved[nameFor(legacy, Object.keys(saved))] = legacy
    await host.store.set(STORE_KEY, saved)
    await host.store.delete(LEGACY_KEY)
  }

  return saved
}

export async function saveUrl(host: Host, url: string, name?: string): Promise<string> {
  const saved = await savedUrls(host)
  const key = name?.trim() || nameFor(url, Object.keys(saved))
  saved[key] = url.trim()
  await host.store.set(STORE_KEY, saved)

  return key
}

export async function forgetUrl(host: Host, name: string): Promise<boolean> {
  const saved = await savedUrls(host)
  if (!(name in saved)) return false
  delete saved[name]
  await host.store.set(STORE_KEY, saved)

  return true
}

async function envTarget(host: Host): Promise<Target> {
  const vars = await host.env()
  if (vars.DATABASE_URL) {
    const parsed = parseUrl(vars.DATABASE_URL)
    if ('env' in parsed) return { kind: 'psql', ...parsed }
  }

  // psql reads PG* and ~/.pgpass from the host by itself; this is the label.
  const shown: Record<string, string> = {}
  if (vars.PGHOST) shown.PGHOST = vars.PGHOST
  if (vars.PGPORT) shown.PGPORT = vars.PGPORT
  const user = vars.PGUSER ?? vars.USER
  if (user) shown.PGUSER = user
  if (vars.PGDATABASE) shown.PGDATABASE = vars.PGDATABASE

  return { kind: 'psql', env: {}, label: labelOf(shown) }
}

/** Every source: saved first, then the host's own when it names one no saved one does, then Docker's. */
export async function listSources(host: Host): Promise<DbSource[]> {
  const sources: DbSource[] = []

  for (const [name, url] of Object.entries(await savedUrls(host))) {
    const parsed = parseUrl(url)
    const env = 'env' in parsed ? parsed.env : {}
    sources.push({
      id: `saved:${name}`,
      origin: 'saved',
      label: name,
      detail: 'env' in parsed ? parsed.label : 'not a postgres:// URL',
      host: env.PGHOST ?? 'localhost',
      port: env.PGPORT ?? '5432',
    })
  }

  const containers = await discover(host)
  const vars = await host.env()
  const hostNamesOne = Boolean(vars.DATABASE_URL || vars.PGHOST || vars.PGDATABASE)
  const target = await envTarget(host)
  const isSaved = sources.some(one => one.detail === target.label)
  if ((hostNamesOne && !isSaved) || (sources.length === 0 && containers.length === 0)) {
    const env = target.kind === 'psql' && vars.DATABASE_URL ? target.env : vars
    sources.push({
      id: 'env',
      origin: 'env',
      label: env.PGDATABASE ?? (vars.DATABASE_URL ? 'DATABASE_URL' : 'default'),
      detail: target.label,
      host: env.PGHOST ?? 'localhost',
      port: env.PGPORT ?? '5432',
    })
  }

  for (const one of containers) sources.push(one.source)

  return sources
}

export async function resolveTarget(host: Host, source: string): Promise<Target | { error: string }> {
  if (source === 'env') return envTarget(host)

  if (source.startsWith('saved:')) {
    const url = (await savedUrls(host))[source.slice('saved:'.length)]
    if (!url) return { error: 'That saved connection is gone. Refresh the view.' }
    const parsed = parseUrl(url)
    if ('error' in parsed) return parsed

    return { kind: 'psql', ...parsed }
  }

  if (source.startsWith('docker:')) {
    const container = source.slice('docker:'.length)
    const found = (await discover(host)).find(one => one.target.container === container)
    if (!found) return { error: `The container ${container} is not running.` }

    return { kind: 'docker', label: found.source.detail, ...found.target }
  }

  return { error: `Unknown source ${source}.` }
}
