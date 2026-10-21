import type { Connection } from './connection'
import type { Host } from './host'

// The driver: one psql run per request, SQL on stdin, one JSON document on
// stdout. Every session is read-only with a statement timeout, set through
// PGOPTIONS so no SQL of ours can forget it.

const CANDIDATES = [
  '/opt/homebrew/bin/psql',
  '/opt/homebrew/opt/libpq/bin/psql',
  '/usr/local/bin/psql',
  '/usr/local/opt/libpq/bin/psql',
  '/Applications/Postgres.app/Contents/Versions/latest/bin/psql',
  '/usr/bin/psql',
]

const STATEMENT_TIMEOUT_MS = 10_000

let found: string | undefined

async function locate(host: Host, configured: string): Promise<string> {
  if (configured !== 'psql') return configured
  if (found) return found

  for (const path of ['psql', ...CANDIDATES]) {
    try {
      const { exitCode } = await host.run([path, '--version'], { timeoutMs: 5_000 })
      if (exitCode === 0) {
        found = path

        return path
      }
    } catch {
      // not there; try the next
    }
  }
  throw new Error('psql was not found. Install the PostgreSQL client, or set the psql path in /config.')
}

export type Variables = Record<string, string>

export async function runJson<T>(
  host: Host,
  connection: Connection,
  psqlPath: string,
  sql: string,
  variables: Variables = {},
): Promise<{ ok: true; value: T; ms: number } | { ok: false; error: string }> {
  let executable: string
  try {
    executable = await locate(host, psqlPath)
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }

  const argv = [executable, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1']
  for (const [name, value] of Object.entries(variables)) argv.push('-v', `${name}=${value}`)
  argv.push('-f', '-')

  const env: Record<string, string> = {
    ...connection.env,
    PGAPPNAME: 'claude-dbview',
    PGCONNECT_TIMEOUT: '5',
    PGOPTIONS: `-c default_transaction_read_only=on -c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
  }

  const startedAt = await host.now()
  let ran
  try {
    ran = await host.run(argv, { env, stdin: sql, timeoutMs: STATEMENT_TIMEOUT_MS + 10_000 })
  } catch (error) {
    return { ok: false, error: `psql did not finish: ${(error as Error).message}` }
  }
  const ms = Math.round((await host.now()) - startedAt)

  if (ran.exitCode !== 0) return { ok: false, error: plainError(ran.stderr) }
  if (ran.isStdoutTruncated) return { ok: false, error: 'The answer was larger than 4 MB.' }

  try {
    return { ok: true, value: JSON.parse(ran.stdout) as T, ms }
  } catch {
    return { ok: false, error: 'psql answered something that is not JSON.' }
  }
}

/** psql's stderr, cut to the one line that says what went wrong. */
export function plainError(stderr: string): string {
  const lines = stderr.split('\n').map(line => line.trim()).filter(Boolean)
  const fatal = lines.find(line => line.includes('FATAL:'))
  if (fatal) return fatal.slice(fatal.indexOf('FATAL:') + 6).trim()
  const error = lines.find(line => /ERROR:/.test(line))
  if (error) return error.slice(error.indexOf('ERROR:') + 6).trim()
  const psql = lines.find(line => line.startsWith('psql: error:'))
  if (psql) return psql.slice('psql: error:'.length).trim()

  return lines[0] ?? 'psql failed without saying why.'
}

/** A Postgres identifier, quoted. */
export function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}
