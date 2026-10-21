import type { DbCatalog, DbRef, DbRowLimit, DbTab, DbView } from '../../types'
import type { Engine } from '../engine/engine'
import { EMPTY_VIEW, folderId, relationId, relationKey, schemaId, sourceId } from './state'
import type { ViewPort } from './state'

// What a press or a command does: ask the engine, write the answer to the
// view. The pane redraws from the view by itself.

export const ROW_LIMITS: DbRowLimit[] = [50, 100, 500, 1000]

export type Actions = ReturnType<typeof createActions>

export function createActions(engine: Engine, port: ViewPort) {
  /** Lists the sources again; opens the first one the first time. */
  async function loadSources(): Promise<void> {
    await port.set(v => ({ ...v, sourcesStatus: { phase: 'loading' } }))
    const answer = await engine.request({ op: 'sources' })
    if (!answer.ok) {
      await port.set(v => ({ ...v, sourcesStatus: { phase: 'error', error: answer.error } }))

      return
    }

    const before = await port.get()
    const isFirst = before.sources.length === 0
    const ids = new Set(answer.value.map(one => one.id))
    await port.set(v => ({
      ...v,
      sources: answer.value,
      sourcesStatus: { phase: 'ready' },
      selected: v.selected && ids.has(v.selected.source) ? v.selected : null,
    }))

    const first = answer.value[0]
    if (isFirst && first) await pickSource(first.id)
  }

  /** Lists the sources and reloads every catalog already open. */
  async function refresh(): Promise<void> {
    await port.set(v => ({ ...v, relations: {}, preview: null, ddl: null }))
    await loadSources()
    const now = await port.get()
    const open = Object.keys(now.catalogs).filter(id => now.sources.some(one => one.id === id))
    await port.set(v => ({ ...v, catalogs: Object.fromEntries(open.flatMap(id => (v.catalogs[id] ? [[id, v.catalogs[id]]] : []))) }))
    await Promise.all(open.map(id => loadCatalog(id)))
    const still = (await port.get()).selected
    if (still) await fill(still)
  }

  async function loadCatalog(source: string): Promise<void> {
    await port.set(v => ({ ...v, status: { ...v.status, [source]: { phase: 'loading' } } }))
    const answer = await engine.request({ op: 'catalog', source })
    if (!answer.ok) {
      await port.set(v => ({ ...v, status: { ...v.status, [source]: { phase: 'error', error: answer.error } } }))

      return
    }

    await port.set(v => ({
      ...v,
      catalogs: { ...v.catalogs, [source]: answer.value },
      status: { ...v.status, [source]: { phase: 'ready' } },
      expanded: v.catalogs[source] ? v.expanded : [...v.expanded, ...initialExpansion(source, answer.value)],
    }))
  }

  /** The source's row: fold or unfold it, loading its catalog the first time. */
  async function toggleSource(source: string): Promise<void> {
    const id = sourceId(source)
    const now = await port.get()
    await toggle(id)
    if (!now.expanded.includes(id) && !now.catalogs[source]) await loadCatalog(source)
  }

  /** The picker: show this source unfolded and the others folded. */
  async function pickSource(source: string): Promise<void> {
    const id = sourceId(source)
    await port.set(v => ({ ...v, expanded: [...v.expanded.filter(one => !one.startsWith('c:')), id] }))
    if (!(await port.get()).catalogs[source]) await loadCatalog(source)
  }

  async function toggle(id: string): Promise<void> {
    await port.set(v => ({
      ...v,
      expanded: v.expanded.includes(id) ? v.expanded.filter(one => one !== id) : [...v.expanded, id],
    }))
  }

  async function pressRelation(ref: DbRef): Promise<void> {
    const id = relationId(ref.source, ref.schema, ref.name)
    const current = (await port.get()).selected
    if (current && sameRef(current, ref)) {
      await toggle(id)

      return
    }

    await port.set(v => ({
      ...v,
      expanded: v.expanded.includes(id) ? v.expanded : [...v.expanded, id],
      selected: ref,
      preview: null,
      ddl: null,
      tab: ref.kind === 'sequence' ? 'ddl' : v.tab === 'ddl' && current?.kind === 'sequence' ? 'rows' : v.tab,
    }))
    await fill(ref)
  }

  async function setTab(tab: DbTab): Promise<void> {
    await port.set(v => ({ ...v, tab }))
    const now = await port.get()
    if (now.selected) await fill(now.selected)
  }

  async function setLimit(limit: DbRowLimit): Promise<void> {
    await port.set(v => ({ ...v, limit, preview: null }))
    const now = await port.get()
    if (now.selected) await fill(now.selected)
  }

  async function setFilter(filter: string): Promise<void> {
    await port.set(v => ({ ...v, filter }))
  }

  async function reset(): Promise<void> {
    await port.set(() => EMPTY_VIEW)
  }

  /** Loads what the open object's current tab needs and is not yet held. */
  async function fill(ref: DbRef): Promise<void> {
    const key = relationKey(ref.source, ref.schema, ref.name)
    await port.set(v => ({ ...v, detailStatus: { phase: 'loading' } }))

    let detail = (await port.get()).relations[key]
    if (!detail) {
      const answer = await engine.request({ op: 'relation', source: ref.source, schema: ref.schema, name: ref.name })
      if (!(await isOpen(ref))) return
      if (!answer.ok) return fail(answer.error)
      detail = answer.value
      await port.set(v => ({ ...v, relations: { ...v.relations, [key]: answer.value } }))
    }

    const now = await port.get()
    if (now.tab === 'rows' && now.preview === null && ref.kind !== 'sequence') {
      const answer = await engine.request({
        op: 'preview',
        source: ref.source,
        schema: ref.schema,
        name: ref.name,
        columns: detail.columns.map(column => column.name),
        order: detail.columns.filter(column => column.isPrimaryKey).map(column => column.name),
        limit: now.limit,
      })
      if (!(await isOpen(ref))) return
      if (!answer.ok) return fail(answer.error)
      await port.set(v => ({ ...v, preview: answer.value }))
    }

    if (now.tab === 'ddl' && now.ddl === null) {
      const answer = await engine.request({ op: 'ddl', source: ref.source, schema: ref.schema, name: ref.name })
      if (!(await isOpen(ref))) return
      if (!answer.ok) return fail(answer.error)
      await port.set(v => ({ ...v, ddl: answer.value }))
    }

    await port.set(v => ({ ...v, detailStatus: { phase: 'ready' } }))
  }

  async function fail(error: string): Promise<void> {
    await port.set(v => ({ ...v, detailStatus: { phase: 'error', error } }))
  }

  async function isOpen(ref: DbRef): Promise<boolean> {
    const now = (await port.get()).selected

    return now !== null && sameRef(now, ref)
  }

  return { loadSources, refresh, loadCatalog, toggleSource, pickSource, toggle, pressRelation, setTab, setLimit, setFilter, reset }
}

function sameRef(a: DbRef, b: DbRef): boolean {
  return a.source === b.source && a.schema === b.schema && a.name === b.name
}

/** A small database opens with its schemas and their tables showing. */
function initialExpansion(source: string, value: DbCatalog): DbView['expanded'] {
  const busy = value.schemas.filter(schema => schema.relations.length + schema.routines.length > 0)
  if (busy.length > 3) return []

  return busy.flatMap(schema => [schemaId(source, schema.name), folderId(source, schema.name, 'tables')])
}
