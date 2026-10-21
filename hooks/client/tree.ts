import type { DbCatalog, DbRef, DbRelation, DbSchema, DbSource, DbView } from '../../types'
import type { Actions } from './actions'
import type { IconName } from './icons'
import { folderId, relationId, relationKey, schemaId, sourceId } from './state'

// The tree as rows, in the order the pane draws them: data source, schema,
// kind folder, object, column. Plain values, so the pane draws them and a
// jump can find where its target sits.

export type Row = {
  key: string
  depth: number
  icon: IconName
  isTile?: boolean
  label: string
  meta?: string
  isMono?: boolean
  isError?: boolean
  /** A connection's state, drawn as a dot at the right. */
  dot?: 'connected' | 'idle' | 'error'
  /** undefined for a leaf; else whether its children show. */
  isOpen?: boolean
  isSelected?: boolean
  onPress?: () => void
}

type Folder = { id: string; label: string; kinds: DbRelation['kind'][] }

export const FOLDERS: Folder[] = [
  { id: 'tables', label: 'Tables', kinds: ['table', 'partitioned', 'foreign'] },
  { id: 'views', label: 'Views', kinds: ['view'] },
  { id: 'matviews', label: 'Materialized views', kinds: ['matview'] },
  { id: 'sequences', label: 'Sequences', kinds: ['sequence'] },
]

export const KIND_ICON: Record<DbRelation['kind'], IconName> = {
  table: 'table',
  partitioned: 'table',
  foreign: 'table',
  view: 'view',
  matview: 'matview',
  sequence: 'sequence',
}

/** The kind folder an object sits in. */
export function folderOf(kind: DbRelation['kind']): string {
  return FOLDERS.find(folder => folder.kinds.includes(kind))?.id ?? 'tables'
}

export function stateOf(view: DbView, source: DbSource): Row['dot'] {
  return view.status[source.id]?.phase === 'error' ? 'error' : view.catalogs[source.id] ? 'connected' : 'idle'
}

/** Every row the tree shows now; with `act`, each row's press too. */
export function listTree(view: DbView, act?: Actions): Row[] {
  const filter = view.filter.trim().toLowerCase()

  function sourceRows(source: DbSource): Row[] {
    const out: Row[] = []
    const cid = sourceId(source.id)
    const catalog = view.catalogs[source.id]
    const status = view.status[source.id]
    const isOpen = view.expanded.includes(cid)
    out.push({
      key: cid,
      depth: 0,
      icon: 'database',
      isTile: true,
      label: source.label,
      meta: status?.phase === 'loading' ? '…' : [source.port ? `:${source.port}` : '', source.origin === 'docker' ? 'docker' : ''].filter(Boolean).join(' · '),
      dot: stateOf(view, source),
      isOpen,
      onPress: act && (() => void act.toggleSource(source.id)),
    })
    if (!isOpen) return out
    if (status?.phase === 'error') {
      out.push({ key: `${cid}:error`, depth: 1, icon: 'column', label: status.error, isError: true })

      return out
    }
    if (catalog) out.push(...catalogRows(source.id, catalog))

    return out
  }

  function catalogRows(source: string, value: DbCatalog): Row[] {
    const out: Row[] = []
    const isOpen = (id: string) => filter !== '' || view.expanded.includes(id)

    for (const schema of value.schemas) {
      const relations = schema.relations.filter(relation => matches(source, schema, relation))
      const routines = schema.routines.filter(routine => filter === '' || routine.name.toLowerCase().includes(filter))
      if (filter !== '' && relations.length + routines.length === 0) continue

      const sid = schemaId(source, schema.name)
      out.push({
        key: sid,
        depth: 1,
        icon: 'schema',
        label: schema.name,
        meta: String(relations.length + routines.length),
        isOpen: isOpen(sid),
        onPress: act && (() => void act.toggle(sid)),
      })
      if (!isOpen(sid)) continue

      for (const folder of FOLDERS) {
        const items = relations.filter(relation => folder.kinds.includes(relation.kind))
        if (items.length === 0) continue
        const fid = folderId(source, schema.name, folder.id)
        out.push({
          key: fid,
          depth: 2,
          icon: 'folder',
          label: folder.label,
          meta: String(items.length),
          isOpen: isOpen(fid),
          onPress: act && (() => void act.toggle(fid)),
        })
        if (isOpen(fid)) for (const relation of items) out.push(...relationRows(source, schema, relation))
      }

      if (routines.length > 0) {
        const fid = folderId(source, schema.name, 'functions')
        out.push({
          key: fid,
          depth: 2,
          icon: 'folder',
          label: 'Functions',
          meta: String(routines.length),
          isOpen: isOpen(fid),
          onPress: act && (() => void act.toggle(fid)),
        })
        if (isOpen(fid)) {
          for (const [index, routine] of routines.entries()) {
            out.push({
              key: `p:${source}|${schema.name}.${routine.name}:${index}`,
              depth: 3,
              icon: 'function',
              isTile: true,
              label: `${routine.name}(${routine.args})`,
              meta: routine.returns,
            })
          }
        }
      }
    }

    return out
  }

  function matches(source: string, schema: DbSchema, relation: DbRelation): boolean {
    if (filter === '') return true
    if (relation.name.toLowerCase().includes(filter)) return true
    const known = view.relations[relationKey(source, schema.name, relation.name)]?.columns ?? []

    return known.some(column => column.name.toLowerCase().includes(filter))
  }

  function relationRows(source: string, schema: DbSchema, relation: DbRelation): Row[] {
    const rid = relationId(source, schema.name, relation.name)
    const ref: DbRef = { source, schema: schema.name, name: relation.name, kind: relation.kind }
    const isLeaf = relation.kind === 'sequence'
    const isOpen = !isLeaf && view.expanded.includes(rid)
    const out: Row[] = [
      {
        key: rid,
        depth: 3,
        icon: KIND_ICON[relation.kind],
        isTile: true,
        label: relation.name,
        meta: relation.rows === null ? undefined : compact(relation.rows),
        isOpen: isLeaf ? undefined : isOpen,
        isSelected: view.selected !== null && sameRef(view.selected, ref),
        onPress: act && (() => void act.pressRelation(ref)),
      },
    ]
    if (!isOpen) return out

    const known = view.relations[relationKey(source, schema.name, relation.name)]?.columns
    if (!known) return [...out, { key: `${rid}:loading`, depth: 4, icon: 'column', label: '…' }]

    // A foreign key column looks as any other; a press follows it to its table.
    return [
      ...out,
      ...known.map(column => {
        const target = column.target ?? null

        return {
          key: `${rid}:${column.name}`,
          depth: 4,
          icon: (column.isPrimaryKey ? 'key' : column.references ? 'link' : 'column') as IconName,
          label: column.name,
          meta: shortType(column.type),
          isMono: true,
          onPress: target && act ? () => void act.jump({ source, ...target }) : undefined,
        }
      }),
    ]
  }

  return view.sources.flatMap(source => sourceRows(source))
}

export function sameRef(a: Pick<DbRef, 'source' | 'schema' | 'name'>, b: Pick<DbRef, 'source' | 'schema' | 'name'>): boolean {
  return a.source === b.source && a.schema === b.schema && a.name === b.name
}

/** The tree's short spelling of a type: `timestamp with time zone` → `timestamptz`. */
export function shortType(type: string): string {
  return type
    .replace('timestamp with time zone', 'timestamptz')
    .replace('timestamp without time zone', 'timestamp')
    .replace('time with time zone', 'timetz')
    .replace('time without time zone', 'time')
    .replace('character varying', 'varchar')
    .replace(/^character\b/, 'char')
    .replace('double precision', 'float8')
}

export function compact(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 100) / 10}k`

  return `${Math.round(n / 100_000) / 10}M`
}
