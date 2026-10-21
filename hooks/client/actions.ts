import type { DbCatalog, DbRef, DbRelationName, DbRowLimit, DbScroll, DbTab, DbView } from '../../types'
import type { Engine } from '../engine/engine'
import { EMPTY_SCROLL, EMPTY_VIEW, folderId, relationId, relationKey, schemaId, sourceId } from './state'
import type { ViewPort } from './state'
import { folderOf, listTree, sameRef } from './tree'

// What a press or a command does: ask the engine, write the answer to the
// view. The pane redraws from the view by itself.

export const ROW_LIMITS: DbRowLimit[] = [50, 100, 500, 1000]

/** How many jumps Back remembers. */
const TRAIL_MAX = 20
/** Rows of the tree kept above an object a jump lands on. */
const REVEAL_ABOVE = 3

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
      trail: (v.trail ?? []).filter(one => ids.has(one.source)),
    }))

    const first = answer.value[0]
    if (isFirst && first) await pickSource(first.id)
  }

  /** Lists the sources and reloads every catalog already open. */
  async function refresh(): Promise<void> {
    // Columns load again on demand, so fold every table but the open one.
    await port.set(v => ({
      ...v,
      relations: {},
      preview: null,
      ddl: null,
      expanded: v.expanded.filter(id => !id.startsWith('r:') || (v.selected !== null && id === relationId(v.selected.source, v.selected.schema, v.selected.name))),
    }))
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
      trail: [],
    }))
    await fill(ref)
  }

  /**
   * Follows a foreign key, as a link in a file tree: the table it points at
   * opens on the same tab, unfolded and brought into view in the tree. The
   * object left behind goes on the trail, for Back.
   */
  async function jump(to: DbRelationName & { source: string }): Promise<void> {
    const now = await port.get()
    if (now.selected && sameRef(now.selected, to)) return
    await land(to, now.selected ? [...(now.trail ?? []), now.selected].slice(-TRAIL_MAX) : (now.trail ?? []))
  }

  /** Returns to the object the last jump left. */
  async function back(): Promise<void> {
    const trail = (await port.get()).trail ?? []
    const last = trail[trail.length - 1]
    if (last) await land(last, trail.slice(0, -1))
  }

  async function land(to: DbRelationName & { source: string }, trail: DbRef[]): Promise<void> {
    const relation = (await port.get()).catalogs[to.source]?.schemas
      .find(schema => schema.name === to.schema)
      ?.relations.find(one => one.name === to.name)
    const ref: DbRef = { source: to.source, schema: to.schema, name: to.name, kind: relation?.kind ?? 'table' }
    const rid = relationId(ref.source, ref.schema, ref.name)
    const path = [sourceId(ref.source), schemaId(ref.source, ref.schema), folderId(ref.source, ref.schema, folderOf(ref.kind)), rid]

    await port.set(v => {
      const next: DbView = {
        ...v,
        expanded: [...v.expanded, ...path.filter(id => !v.expanded.includes(id))],
        selected: ref,
        preview: null,
        ddl: null,
        tab: ref.kind === 'sequence' ? 'ddl' : v.tab,
        trail,
      }
      // A filter that hides the target gives way; then the tree moves to it.
      const shown = listTree(next).some(row => row.key === rid) ? next : { ...next, filter: '' }
      const at = listTree(shown).findIndex(row => row.key === rid)

      return { ...shown, scroll: { ...(v.scroll ?? EMPTY_SCROLL), tree: Math.max(0, at - REVEAL_ABOVE) } }
    })
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
    await port.set(v => ({ ...v, filter, scroll: { ...(v.scroll ?? EMPTY_SCROLL), tree: 0 } }))
  }

  /** Moves the tree's or the open section's window; the pane clamps what it draws. */
  async function setScroll(scroll: DbScroll): Promise<void> {
    await port.set(v => ({ ...v, scroll }))
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

  return { loadSources, refresh, loadCatalog, toggleSource, pickSource, toggle, pressRelation, jump, back, setTab, setLimit, setFilter, setScroll, reset }
}

/** A small database opens with its schemas and their tables showing. */
function initialExpansion(source: string, value: DbCatalog): DbView['expanded'] {
  const busy = value.schemas.filter(schema => schema.relations.length + schema.routines.length > 0)
  if (busy.length > 3) return []

  return busy.flatMap(schema => [schemaId(source, schema.name), folderId(source, schema.name, 'tables')])
}
