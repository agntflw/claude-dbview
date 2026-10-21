import type { DbScroll, DbView } from '../../types'

// The one value the pane draws from (`dbview.view`, declared in the
// contract and held as an atom in the hooks module). The engine's answers
// land in it; the pane reads it while drawing and its presses write it.

export const EMPTY_SCROLL: DbScroll = { tree: 0, detail: 0, left: 0, for: '' }

export const EMPTY_VIEW: DbView = {
  sources: [],
  sourcesStatus: { phase: 'idle' },
  catalogs: {},
  status: {},
  expanded: [],
  selected: null,
  relations: {},
  preview: null,
  ddl: null,
  detailStatus: { phase: 'idle' },
  tab: 'rows',
  limit: 50,
  filter: '',
  scroll: EMPTY_SCROLL,
}

/** How the client reads and writes its value, handed down from a hook. */
export type ViewPort = {
  get: () => Promise<DbView>
  set: (change: (value: DbView) => DbView) => Promise<unknown>
}

// Tree node ids. `|` keeps a source, a schema and a name apart.
export const sourceId = (source: string) => `c:${source}`
export const schemaId = (source: string, schema: string) => `s:${source}|${schema}`
export const folderId = (source: string, schema: string, folder: string) => `f:${source}|${schema}|${folder}`
export const relationId = (source: string, schema: string, name: string) => `r:${source}|${schema}.${name}`
export const relationKey = (source: string, schema: string, name: string) => `${source}|${schema}.${name}`
