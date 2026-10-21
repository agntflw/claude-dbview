import type { DbCatalog, DbRef, DbTab, DbView } from '../../types'
import type { Engine } from '../engine/engine'
import { EMPTY_VIEW, folderId, relationId, relationKey, schemaId } from './state'
import type { ViewPort } from './state'

// What a press or a command does: ask the engine, write the answer to the
// view. The pane redraws from the view by itself.

export const PREVIEW_ROWS = 50

export type Actions = ReturnType<typeof createActions>

export function createActions(engine: Engine, port: ViewPort) {
  async function loadCatalog(): Promise<void> {
    await port.set(v => ({ ...v, status: { phase: 'loading' } }))
    const label = await engine.label()
    await port.set(v => ({ ...v, target: label }))

    const answer = await engine.request({ op: 'catalog' })
    if (!answer.ok) {
      await port.set(v => ({ ...v, status: { phase: 'error', error: answer.error } }))

      return
    }

    const before = await port.get()
    await port.set(v => ({
      ...v,
      catalog: answer.value,
      columns: {},
      status: { phase: 'ready' },
      expanded: before.catalog === null ? initialExpansion(answer.value) : v.expanded,
    }))

    const still = (await port.get()).selected
    if (still) await open(still)
  }

  async function toggle(id: string): Promise<void> {
    await port.set(v => ({
      ...v,
      expanded: v.expanded.includes(id) ? v.expanded.filter(one => one !== id) : [...v.expanded, id],
    }))
  }

  async function pressRelation(ref: DbRef): Promise<void> {
    const id = relationId(ref.schema, ref.name)
    const current = (await port.get()).selected
    if (current?.schema === ref.schema && current.name === ref.name) {
      await toggle(id)

      return
    }

    await port.set(v => ({ ...v, expanded: v.expanded.includes(id) ? v.expanded : [...v.expanded, id] }))
    await open(ref)
  }

  async function setTab(tab: DbTab): Promise<void> {
    await port.set(v => ({ ...v, tab }))
    const now = await port.get()
    if (now.selected) await fill(now.selected)
  }

  async function setFilter(filter: string): Promise<void> {
    await port.set(v => ({ ...v, filter }))
  }

  async function reset(): Promise<void> {
    await port.set(() => EMPTY_VIEW)
  }

  async function open(ref: DbRef): Promise<void> {
    await port.set(v => ({
      ...v,
      selected: ref,
      preview: null,
      ddl: null,
      tab: ref.kind === 'sequence' && v.tab === 'rows' ? 'ddl' : v.tab,
      detailStatus: { phase: 'loading' },
    }))
    await fill(ref)
  }

  /** Loads what the open object's current tab needs and is not yet held. */
  async function fill(ref: DbRef): Promise<void> {
    const key = relationKey(ref.schema, ref.name)
    let now = await port.get()

    let known = now.columns[key]
    if (!known && ref.kind !== 'sequence') {
      await port.set(v => ({ ...v, detailStatus: { phase: 'loading' } }))
      const answer = await engine.request({ op: 'columns', schema: ref.schema, name: ref.name })
      if (!(await isOpen(ref))) return
      if (!answer.ok) return fail(answer.error)
      known = answer.value
      await port.set(v => ({ ...v, columns: { ...v.columns, [key]: answer.value } }))
    }

    now = await port.get()
    if (now.tab === 'rows' && now.preview === null && known) {
      await port.set(v => ({ ...v, detailStatus: { phase: 'loading' } }))
      const answer = await engine.request({
        op: 'preview',
        schema: ref.schema,
        name: ref.name,
        columns: known.map(column => column.name),
        limit: PREVIEW_ROWS,
      })
      if (!(await isOpen(ref))) return
      if (!answer.ok) return fail(answer.error)
      await port.set(v => ({ ...v, preview: answer.value }))
    }

    if (now.tab === 'ddl' && now.ddl === null) {
      await port.set(v => ({ ...v, detailStatus: { phase: 'loading' } }))
      const answer = await engine.request({ op: 'ddl', schema: ref.schema, name: ref.name })
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

    return now?.schema === ref.schema && now.name === ref.name
  }

  return { loadCatalog, toggle, pressRelation, setTab, setFilter, reset }
}

/** A small database opens with its schemas and their tables showing. */
function initialExpansion(value: DbCatalog): DbView['expanded'] {
  const busy = value.schemas.filter(schema => schema.relations.length + schema.routines.length > 0)
  if (busy.length > 3) return []

  return busy.flatMap(schema => [schemaId(schema.name), folderId(schema.name, 'tables')])
}
