import type { DbView } from '../../types'

// The one value the pane draws from (`dbview.view`, declared in the
// contract and held as an atom in the hooks module). The engine's answers
// land in it; the pane reads it while drawing and its presses write it.

export const EMPTY_VIEW: DbView = {
  target: null,
  status: { phase: 'idle' },
  catalog: null,
  expanded: [],
  selected: null,
  columns: {},
  preview: null,
  ddl: null,
  detailStatus: { phase: 'idle' },
  tab: 'rows',
  filter: '',
}

/** How the client reads and writes its value, handed down from a hook. */
export type ViewPort = {
  get: () => Promise<DbView>
  set: (change: (value: DbView) => DbView) => Promise<unknown>
}

export const schemaId = (schema: string) => `s:${schema}`
export const folderId = (schema: string, folder: string) => `f:${schema}:${folder}`
export const relationId = (schema: string, name: string) => `r:${schema}.${name}`
export const relationKey = (schema: string, name: string) => `${schema}.${name}`
