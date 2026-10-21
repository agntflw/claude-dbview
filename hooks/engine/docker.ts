import type { DbSource } from '../../types'
import type { Host } from './host'
import { DOCKER_CANDIDATES, locate } from './locate'

// Postgres containers Docker is running, as data sources. The engine reaches
// one through `docker exec … psql` inside it, so it needs no published port,
// no password and no psql on the host.

const POSTGRES_IMAGE = /postgres|postgis|timescale|pgvector|supabase|postgresql/i

export type DockerTarget = { container: string; user: string; database: string }

type PsLine = { Names?: string; Image?: string; Ports?: string; State?: string }
type Inspect = {
  Name?: string
  Config?: { Image?: string; Env?: string[] }
  NetworkSettings?: { Ports?: Record<string, { HostPort?: string }[] | null> }
}

export async function dockerPath(host: Host): Promise<string | undefined> {
  return locate(host, 'docker', DOCKER_CANDIDATES)
}

/** Every running Postgres container; none when Docker is absent or stopped. */
export async function discover(host: Host): Promise<{ source: DbSource; target: DockerTarget }[]> {
  const docker = await dockerPath(host)
  if (!docker) return []

  let ps
  try {
    ps = await host.run([docker, 'ps', '--format', '{{json .}}'], { timeoutMs: 5_000 })
  } catch {
    return []
  }
  if (ps.exitCode !== 0) return []

  const names = ps.stdout
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line) as PsLine
      } catch {
        return {}
      }
    })
    .filter(one => one.Names && (POSTGRES_IMAGE.test(one.Image ?? '') || (one.Ports ?? '').includes('5432/tcp')))
    .map(one => (one.Names ?? '').split(',')[0] ?? '')
    .filter(Boolean)
  if (names.length === 0) return []

  let inspected
  try {
    inspected = await host.run([docker, 'inspect', ...names], { timeoutMs: 5_000 })
  } catch {
    return []
  }
  if (inspected.exitCode !== 0) return []

  let details: Inspect[]
  try {
    details = JSON.parse(inspected.stdout) as Inspect[]
  } catch {
    return []
  }

  return details
    .map(one => {
      const container = (one.Name ?? '').replace(/^\//, '')
      const env = new Map(
        (one.Config?.Env ?? []).map(pair => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]),
      )
      const user = env.get('POSTGRES_USER') || 'postgres'
      const database = env.get('POSTGRES_DB') || user
      const port = one.NetworkSettings?.Ports?.['5432/tcp']?.[0]?.HostPort
      const image = one.Config?.Image ?? 'postgres'
      const source: DbSource = {
        id: `docker:${container}`,
        origin: 'docker',
        label: container,
        detail: `${user}@${image}${port ? ` :${port}` : ''}/${database}`,
        host: 'localhost',
        port: port ?? null,
      }

      return { source, target: { container, user, database } }
    })
    .filter(one => one.target.container !== '')
    .sort((a, b) => a.source.label.localeCompare(b.source.label))
}
