import type { ProcessRunInit, ProcessRunResult } from 'claude-code'

// What the engine needs from Claude Code, as plain functions. The hooks
// module builds it from `$` (which is only ever spelled at its call sites)
// and hands it down, so the engine stays testable and free of `$`.

export type Host = {
  run: (argv: string[], init: ProcessRunInit) => Promise<ProcessRunResult>
  now: () => Promise<number>
  store: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<void>
  }
  /** The host's own connection variables, read when a request is made. */
  env: () => Promise<HostEnv>
}

export type HostEnv = {
  DATABASE_URL?: string
  PGHOST?: string
  PGPORT?: string
  PGUSER?: string
  PGDATABASE?: string
  USER?: string
}
