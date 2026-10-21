// The contract between the engine (server side, runs in the Claude Code CLI)
// and the pane (client side, drawn on any surface). A phase adds its types
// here first; the engine fills them, the pane reads them.

export type DbRelationKind = 'table' | 'partitioned' | 'view' | 'matview' | 'foreign' | 'sequence'

/** `rows` is the planner's estimate; null before the first ANALYZE. */
export type DbRelation = { name: string; kind: DbRelationKind; rows: number | null }

export type DbRoutine = {
  name: string
  args: string
  returns: string
  kind: 'function' | 'procedure' | 'aggregate' | 'window'
}

export type DbSchema = { name: string; relations: DbRelation[]; routines: DbRoutine[] }

export type DbCatalog = {
  database: string
  user: string
  host: string
  version: string
  schemas: DbSchema[]
}

export type DbColumn = {
  name: string
  type: string
  notNull: boolean
  default: string | null
  isPrimaryKey: boolean
  references: string | null
}

export type DbPreview = {
  columns: string[]
  rows: (string | null)[][]
  limit: number
  ms: number
}

export type DbRef = { schema: string; name: string; kind: DbRelationKind }

/** Where a load stands; `error` is one plain line, never a secret. */
export type DbStatus =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'error'; error: string }

/** What the pane asks of the engine. */
export type EngineRequest =
  | { op: 'catalog' }
  | { op: 'columns'; schema: string; name: string }
  | { op: 'preview'; schema: string; name: string; columns: string[]; limit: number }
  | { op: 'ddl'; schema: string; name: string }

/** What the engine answers, by request. */
export type EngineResultOf = {
  catalog: DbCatalog
  columns: DbColumn[]
  preview: DbPreview
  ddl: string
}

export type EngineResult<Op extends EngineRequest['op']> =
  | { ok: true; value: EngineResultOf[Op] }
  | { ok: false; error: string }

/** Everything the pane draws, in one value: one read per draw, one write per change. */
export type DbView = {
  /** The connection as the pane shows it: `user@host:port/db`, no password. */
  target: string | null
  status: DbStatus
  catalog: DbCatalog | null
  /** Open tree nodes by id: `s:<schema>`, `f:<schema>:<folder>`, `r:<schema>.<name>`. */
  expanded: string[]
  selected: DbRef | null
  /** Columns by relation, `<schema>.<name>`, filled as relations open. */
  columns: Record<string, DbColumn[]>
  preview: DbPreview | null
  ddl: string | null
  detailStatus: DbStatus
  /** Which section of the open object shows. */
  tab: DbTab
  /** The tree's filter, as typed. */
  filter: string
}

export type DbTab = 'columns' | 'rows' | 'ddl'

declare module 'claude-code' {
  interface PluginState {
    dbview: { view: DbView }
  }
}
