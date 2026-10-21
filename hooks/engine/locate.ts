import type { Host } from './host'

// Finds an executable the host can run. A desktop app's PATH is often short,
// so the usual install folders are tried after the bare name.

const found = new Map<string, string>()

export async function locate(host: Host, name: string, candidates: readonly string[]): Promise<string | undefined> {
  const known = found.get(name)
  if (known) return known

  for (const path of [name, ...candidates]) {
    try {
      const { exitCode } = await host.run([path, '--version'], { timeoutMs: 5_000 })
      if (exitCode === 0) {
        found.set(name, path)

        return path
      }
    } catch {
      // not there; try the next
    }
  }

  return undefined
}

export const PSQL_CANDIDATES = [
  '/opt/homebrew/bin/psql',
  '/opt/homebrew/opt/libpq/bin/psql',
  '/usr/local/bin/psql',
  '/usr/local/opt/libpq/bin/psql',
  '/Applications/Postgres.app/Contents/Versions/latest/bin/psql',
  '/usr/bin/psql',
]

export const DOCKER_CANDIDATES = [
  '/usr/local/bin/docker',
  '/opt/homebrew/bin/docker',
  '/Applications/Docker.app/Contents/Resources/bin/docker',
  '/usr/bin/docker',
]
