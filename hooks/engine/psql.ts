import type { Target } from './connection'
import { dockerPath } from './docker'
import type { Host } from './host'
import { PSQL_CANDIDATES, locate } from './locate'

// The driver: one psql run per request, SQL on stdin, one JSON document on
// stdout. Every session is read-only with a statement timeout, set through
// PGOPTIONS so no SQL of ours can forget it. A Docker source runs the psql
// inside its container.

const STATEMENT_TIMEOUT_MS = 10_000
const PGOPTIONS = `-c default_transaction_read_only=on -c statement_timeout=${STATEMENT_TIMEOUT_MS}`
const PSQL_FLAGS = ['-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1']

export type Variables = Record<string, string>

export async function runJson<T>(
  host: Host,
  target: Target,
  psqlPath: string,
  sql: string,
  variables: Variables = {},
): Promise<{ ok: true; value: T; ms: number } | { ok: false; error: string }> {
  const vars = Object.entries(variables).flatMap(([name, value]) => ['-v', `${name}=${value}`])
  let argv: string[]
  let env: Record<string, string> = {}

  if (target.kind === 'docker') {
    const docker = await dockerPath(host)
    if (!docker) return { ok: false, error: 'docker was not found.' }
    argv = [
      docker, 'exec', '-i',
      '-e', `PGOPTIONS=${PGOPTIONS}`,
      '-e', 'PGAPPNAME=claude-dbview',
      target.container,
      'psql', '-U', target.user, '-d', target.database,
      ...PSQL_FLAGS, ...vars, '-f', '-',
    ]
  } else {
    const psql = psqlPath === 'psql' ? await locate(host, 'psql', PSQL_CANDIDATES) : psqlPath
    if (!psql) return { ok: false, error: 'psql was not found. Install the PostgreSQL client, or set the psql path in /config.' }
    argv = [psql, ...PSQL_FLAGS, ...vars, '-f', '-']
    env = { ...target.env, PGAPPNAME: 'claude-dbview', PGCONNECT_TIMEOUT: '5', PGOPTIONS }
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
  if (ran.isStdoutTruncated) return { ok: false, error: 'The answer was larger than 4 MB. Read fewer rows.' }

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
