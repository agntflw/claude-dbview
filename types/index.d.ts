// The contract between the engine (server side, runs in the Claude Code CLI)
// and the pane (client side, drawn on any surface). A phase adds its types
// here first; the engine fills them, the pane reads them.

/**
 * A database the pane can open, as the IDE's explorer lists data sources:
 * one saved with /db connect, the host's own (DATABASE_URL or PG* variables),
 * or a Postgres container Docker is running.
 */
export type DbSource = {
  /** `saved:<name>`, `env` or `docker:<container>`. */
  id: string
  origin: 'saved' | 'env' | 'docker'
  /** The name drawn in the tree. */
  label: string
  /** Where it lives, never a password: `user@host:port/db`, or a container's image and port. */
  detail: string
  /** Where the picker says it is, `localhost`; the tree shows the port alone. */
  host: string
  /** null for a container that publishes no port. */
  port: string | null
}

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
  version: string
  schemas: DbSchema[]
}

export type DbColumn = {
  name: string
  type: string
  notNull: boolean
  default: string | null
  isPrimaryKey: boolean
  /** The column a foreign key points at: `sales.customer(id)`. */
  references: string | null
}

export type DbConstraint = {
  name: string
  kind: 'primary' | 'unique' | 'foreign' | 'check' | 'exclusion' | 'trigger' | 'notnull'
  /** As Postgres prints it: `PRIMARY KEY (id)`, `FOREIGN KEY (customer_id) REFERENCES sales.customer(id)`. */
  definition: string
}

/** `definition` is the index's method and keys: `UNIQUE btree (id)`. */
export type DbIndex = { name: string; definition: string }

/** What opening a relation needs before any rows: its columns, constraints and indexes. */
export type DbRelationDetail = { columns: DbColumn[]; constraints: DbConstraint[]; indexes: DbIndex[] }

export type DbPreview = {
  /** The query as the pane shows it: `SELECT * FROM sales.orders ORDER BY id LIMIT 50;` */
  query: string
  columns: string[]
  rows: (string | null)[][]
  limit: number
  ms: number
}

export type DbRef = { source: string; schema: string; name: string; kind: DbRelationKind }

/** Where a load stands; `error` is one plain line, never a secret. */
export type DbStatus =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'error'; error: string }

/** What the pane asks of the engine. Every request but `sources` names one. */
export type EngineRequest =
  | { op: 'sources' }
  | { op: 'catalog'; source: string }
  | { op: 'relation'; source: string; schema: string; name: string }
  | { op: 'preview'; source: string; schema: string; name: string; columns: string[]; order: string[]; limit: number }
  | { op: 'ddl'; source: string; schema: string; name: string }

/** What the engine answers, by request. */
export type EngineResultOf = {
  sources: DbSource[]
  catalog: DbCatalog
  relation: DbRelationDetail
  preview: DbPreview
  ddl: string
}

export type EngineResult<Op extends EngineRequest['op']> =
  | { ok: true; value: EngineResultOf[Op] }
  | { ok: false; error: string }

export type DbTab = 'columns' | 'rows' | 'ddl'

/** How many rows the Rows tab reads at once. */
export type DbRowLimit = 50 | 100 | 500 | 1000

/** Everything the pane draws, in one value: one read per draw, one write per change. */
export type DbView = {
  sources: DbSource[]
  sourcesStatus: DbStatus
  /** Catalogs and their load state, by source id; a source loads when first opened. */
  catalogs: Record<string, DbCatalog>
  status: Record<string, DbStatus>
  /**
   * Open tree nodes: `c:<source>`, `s:<source>|<schema>`,
   * `f:<source>|<schema>|<folder>`, `r:<source>|<schema>.<name>`.
   */
  expanded: string[]
  selected: DbRef | null
  /** Columns and constraints by relation, `<source>|<schema>.<name>`, filled as relations open. */
  relations: Record<string, DbRelationDetail>
  preview: DbPreview | null
  ddl: string | null
  detailStatus: DbStatus
  /** Which section of the open object shows. */
  tab: DbTab
  limit: DbRowLimit
  /** The tree's filter, as typed. */
  filter: string
}

declare module 'claude-code' {
  interface PluginState {
    dbview: { view: DbView }
  }
}
