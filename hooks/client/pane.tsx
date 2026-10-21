import type { ElementConstructor, Elements, RenderElement } from 'claude-code'

import type { DbCatalog, DbColumn, DbPreview, DbRef, DbRelation, DbSchema, DbTab, DbView } from '../../types'
import type { Actions } from './actions'
import { COLOR, SPACER_SVG, glyphOf, lineSvg, tileSvg } from './icons'
import type { IconName } from './icons'
import { folderId, relationId, relationKey, schemaId } from './state'

// The client side: draws the pane from the view, on whichever surface asks.
// Tree on the left (schema, kind folder, object, column) and the open object
// on the right, as the Claude desktop sidebar sits beside its content;
// stacked when the pane is narrow. Nothing here reaches the database.

type Table = Elements['terminal']

export type PaneInput = {
  els: Pick<Table, 'Box' | 'Text' | 'Button' | 'Code'>
  /** The surface's text field, where it has one (not mobile). */
  Input?: Table['Input']
  /** The surface's SVG image, where it has one (not the terminal). */
  Svg?: ElementConstructor<{ source: string; alt: string; width?: number; height?: number }>
  width: number
  view: DbView
  act: Actions
}

const WIDE_AT = 80
const TREE_COLUMNS = 38
const CELL_MAX = 24

type Row = {
  key: string
  depth: number
  icon: IconName
  isTile?: boolean
  label: string
  meta?: string
  isMono?: boolean
  /** undefined for a leaf; else whether its children show. */
  isOpen?: boolean
  isSelected?: boolean
  onPress?: () => void
}

type Folder = { id: string; label: string; kinds: DbRelation['kind'][] }

const FOLDERS: Folder[] = [
  { id: 'tables', label: 'Tables', kinds: ['table', 'partitioned', 'foreign'] },
  { id: 'views', label: 'Views', kinds: ['view'] },
  { id: 'matviews', label: 'Materialized views', kinds: ['matview'] },
  { id: 'sequences', label: 'Sequences', kinds: ['sequence'] },
]

const KIND_ICON: Record<DbRelation['kind'], IconName> = {
  table: 'table',
  partitioned: 'table',
  foreign: 'table',
  view: 'view',
  matview: 'matview',
  sequence: 'sequence',
}

const TABS: { id: DbTab; label: string; hotkey: string }[] = [
  { id: 'columns', label: 'Columns', hotkey: 'c' },
  { id: 'rows', label: 'Rows', hotkey: 'w' },
  { id: 'ddl', label: 'DDL', hotkey: 'd' },
]

export function drawPane({ els, Input, Svg, width, view, act }: PaneInput): RenderElement {
  const { Box, Text, Button, Code } = els
  const isWide = width >= WIDE_AT
  const treeWidth = isWide ? Math.min(TREE_COLUMNS, Math.floor(width * 0.45)) : width
  const detailWidth = isWide ? width - treeWidth - 3 : width

  const line = (name: IconName, color?: string) =>
    Svg ? <Svg source={lineSvg(name, color)} alt={name} width={16} height={16} /> : <Text dimColor>{glyphOf(name)}</Text>
  const tile = (name: IconName, size: number) =>
    Svg ? <Svg source={tileSvg(name, size)} alt={name} width={size} height={size} /> : <Text color={COLOR.muted}>{glyphOf(name)}</Text>
  const spacer = () => (Svg ? <Svg source={SPACER_SVG} alt="" width={16} height={16} /> : <Text> </Text>)

  // The top line: which database, and the one action it always offers.
  const header = (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center">
      <Box flexDirection="row" gap={1} alignItems="center">
        {tile('database', 20)}
        <Text weight="semibold">{view.catalog?.database ?? 'Database'}</Text>
      </Box>
      <Button key="refresh" label="Refresh" hotkey="r" plain dimColor onPress={() => void act.loadCatalog()} />
    </Box>
  )

  const notice = (() => {
    if (view.status.phase === 'loading' && view.catalog === null) return <Text dimColor>Connecting…</Text>
    if (view.status.phase === 'error') {
      return (
        <Box flexDirection="column">
          <Text color="error">{view.status.error}</Text>
          <Text dimColor>/db connect postgres://user:password@host:5432/database</Text>
        </Box>
      )
    }
    if (view.catalog === null) {
      return (
        <Box flexDirection="column">
          <Text>Not connected.</Text>
          <Text dimColor>/db connect postgres://user:password@host:5432/database</Text>
        </Box>
      )
    }

    return false
  })()

  const filter = view.filter.trim().toLowerCase()
  const rows = view.catalog ? treeRows(view.catalog) : []

  function treeRows(value: DbCatalog): Row[] {
    const out: Row[] = []
    const isOpen = (id: string) => filter !== '' || view.expanded.includes(id)

    for (const schema of value.schemas) {
      const relations = schema.relations.filter(relation => matches(schema, relation))
      const routines = schema.routines.filter(routine => filter === '' || routine.name.toLowerCase().includes(filter))
      if (filter !== '' && relations.length + routines.length === 0) continue

      const sid = schemaId(schema.name)
      const isSchemaOpen = isOpen(sid)
      out.push({
        key: sid,
        depth: 0,
        icon: 'schema',
        label: schema.name,
        meta: String(relations.length + routines.length),
        isOpen: isSchemaOpen,
        onPress: () => void act.toggle(sid),
      })
      if (!isSchemaOpen) continue

      for (const folder of FOLDERS) {
        const items = relations.filter(relation => folder.kinds.includes(relation.kind))
        if (items.length === 0) continue
        const fid = folderId(schema.name, folder.id)
        out.push({
          key: fid,
          depth: 1,
          icon: 'folder',
          label: folder.label,
          meta: String(items.length),
          isOpen: isOpen(fid),
          onPress: () => void act.toggle(fid),
        })
        if (isOpen(fid)) for (const relation of items) relationRows(out, schema, relation)
      }

      if (routines.length > 0) {
        const fid = folderId(schema.name, 'functions')
        out.push({
          key: fid,
          depth: 1,
          icon: 'folder',
          label: 'Functions',
          meta: String(routines.length),
          isOpen: isOpen(fid),
          onPress: () => void act.toggle(fid),
        })
        if (isOpen(fid)) {
          for (const [index, routine] of routines.entries()) {
            out.push({
              key: `p:${schema.name}.${routine.name}:${index}`,
              depth: 2,
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

  function matches(schema: DbSchema, relation: DbRelation): boolean {
    if (filter === '') return true
    if (relation.name.toLowerCase().includes(filter)) return true
    const known = view.columns[relationKey(schema.name, relation.name)] ?? []

    return known.some(column => column.name.toLowerCase().includes(filter))
  }

  function relationRows(out: Row[], schema: DbSchema, relation: DbRelation) {
    const rid = relationId(schema.name, relation.name)
    const ref: DbRef = { schema: schema.name, name: relation.name, kind: relation.kind }
    const isLeaf = relation.kind === 'sequence'
    const isOpen = !isLeaf && view.expanded.includes(rid)
    out.push({
      key: rid,
      depth: 2,
      icon: KIND_ICON[relation.kind],
      isTile: true,
      label: relation.name,
      meta: relation.rows === null ? undefined : compact(relation.rows),
      isOpen: isLeaf ? undefined : isOpen,
      isSelected: view.selected?.schema === schema.name && view.selected.name === relation.name,
      onPress: () => void act.pressRelation(ref),
    })
    if (!isOpen) return

    const known = view.columns[relationKey(schema.name, relation.name)]
    if (!known) {
      out.push({ key: `${rid}:loading`, depth: 3, icon: 'column', label: '…' })

      return
    }
    for (const column of known) {
      out.push({
        key: `${rid}:${column.name}`,
        depth: 3,
        icon: column.isPrimaryKey ? 'key' : column.references ? 'link' : 'column',
        label: column.name,
        meta: column.type,
        isMono: true,
      })
    }
  }

  const drawRow = (row: Row) => {
    const chevron =
      row.isOpen === undefined ? spacer() : line(row.isOpen ? 'chevronDown' : 'chevronRight')
    const icon =
      row.icon === 'key' || row.icon === 'link'
        ? line(row.icon, row.icon === 'key' ? '#e0a94e' : '#6aa6ee')
        : row.isTile
          ? tile(row.icon, 20)
          : line(row.icon)
    const isGroup = row.depth === 0
    const name = row.isSelected ? (
      <Text weight="semibold" color={Svg ? undefined : 'claude'}>
        {row.label}
      </Text>
    ) : isGroup ? (
      <Text dimColor weight="medium">
        {row.label}
      </Text>
    ) : row.isMono ? (
      <Text mono color={Svg ? COLOR.column : undefined}>
        {row.label}
      </Text>
    ) : (
      row.label
    )

    return (
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        paddingLeft={row.depth * 2}
        paddingRight={1}
        backgroundColor={row.isSelected && Svg ? COLOR.pill : undefined}
      >
        <Box flexDirection="row" gap={1} alignItems="center" flexShrink={1}>
          {chevron}
          {icon}
          {row.onPress ? (
            <Button key={row.key} plain onPress={row.onPress}>
              {name}
            </Button>
          ) : (
            <Text wrap="truncate-end">{name}</Text>
          )}
        </Box>
        {row.meta ? (
          <Text dimColor mono={row.isMono} size="footnote" wrap="truncate-end">
            {row.meta}
          </Text>
        ) : (
          ''
        )}
      </Box>
    )
  }

  const filterField =
    Input && view.catalog ? (
      <Box flexDirection="row" gap={1} alignItems="center">
        {line('search')}
        <Input
          key="filter"
          placeholder="Filter tables, columns…"
          value={view.filter}
          submitLabel="filter"
          onInput={value => void act.setFilter(value)}
          onSubmit={value => void act.setFilter(value)}
        />
      </Box>
    ) : (
      false
    )

  const connection = view.catalog ? (
    <Box flexDirection="row" gap={1} alignItems="center">
      <Text color={view.status.phase === 'error' ? 'error' : COLOR.connected}>●</Text>
      <Text dimColor size="footnote" wrap="truncate-end">
        {view.target ?? ''} · PG {view.catalog.version.split(' ')[0]}
      </Text>
    </Box>
  ) : (
    false
  )

  const tree = (
    <Box flexDirection="column" gap={1} width={isWide ? treeWidth : undefined}>
      {filterField}
      <Box flexDirection="column">
        {rows.map(drawRow)}
        {filter !== '' && rows.length === 0 && <Text dimColor>Nothing matches “{view.filter}”.</Text>}
      </Box>
      {connection}
    </Box>
  )

  const detail = view.selected ? drawDetail(view.selected) : false

  function drawDetail(ref: DbRef) {
    const relation = view.catalog?.schemas
      .find(schema => schema.name === ref.schema)
      ?.relations.find(one => one.name === ref.name)
    const known = view.columns[relationKey(ref.schema, ref.name)] ?? []
    const facts: string[] = []
    if (relation?.rows != null) facts.push(`${compact(relation.rows)} rows`)
    if (known.length > 0) facts.push(`${known.length} columns`)
    facts.push(ref.schema)
    const tabs = ref.kind === 'sequence' ? TABS.filter(one => one.id === 'ddl') : TABS

    const section = (() => {
      if (view.detailStatus.phase === 'error') return <Text color="error">{view.detailStatus.error}</Text>
      if (view.tab === 'columns' && known.length > 0) return drawColumns(known)
      if (view.tab === 'rows' && view.preview) return drawGrid(view.preview)
      if (view.tab === 'ddl' && view.ddl !== null) return <Code source={view.ddl} language="sql" />
      if (view.detailStatus.phase === 'loading') return <Text dimColor>Loading…</Text>

      return false
    })()

    return (
      <Box flexDirection="column" gap={1} width={isWide ? detailWidth : undefined}>
        <Box flexDirection="row" gap={1} alignItems="center">
          {tile(KIND_ICON[ref.kind], 32)}
          <Box flexDirection="column">
            <Text size="heading" weight="semibold">
              {ref.name}
            </Text>
            <Text dimColor size="footnote">
              {facts.join(' · ')}
            </Text>
          </Box>
        </Box>
        <Box flexDirection="row" gap={1}>
          {tabs.map(one => (
            <Box paddingX={1} backgroundColor={view.tab === one.id && Svg ? COLOR.pill : undefined}>
              <Button key={`tab-${one.id}`} plain hotkey={one.hotkey} onPress={() => void act.setTab(one.id)}>
                {view.tab === one.id ? <Text weight="semibold">{one.label}</Text> : <Text dimColor>{one.label}</Text>}
              </Button>
            </Box>
          ))}
        </Box>
        {section}
      </Box>
    )
  }

  function drawColumns(list: DbColumn[]) {
    const nameWidth = Math.min(CELL_MAX, Math.max(...list.map(column => column.name.length))) + 2
    const typeWidth = Math.min(CELL_MAX, Math.max(...list.map(column => column.type.length))) + 2

    return (
      <Box flexDirection="column">
        {list.map(column => (
          <Box flexDirection="row" alignItems="center">
            <Box width={3}>
              {column.isPrimaryKey
                ? line('key', '#e0a94e')
                : column.references
                  ? line('link', '#6aa6ee')
                  : line('column')}
            </Box>
            <Box width={nameWidth}>
              <Text mono wrap="truncate-end" weight={column.isPrimaryKey ? 'semibold' : 'regular'}>
                {column.name}
              </Text>
            </Box>
            <Box width={typeWidth}>
              <Text mono dimColor wrap="truncate-end">
                {column.type}
              </Text>
            </Box>
            <Text dimColor size="footnote" wrap="truncate-end">
              {flagsOf(column)}
            </Text>
          </Box>
        ))}
      </Box>
    )
  }

  function drawGrid(value: DbPreview) {
    const widths = value.columns.map((name, index) =>
      Math.min(CELL_MAX, Math.max(name.length, ...value.rows.map(row => cellText(row[index] ?? null).length))),
    )
    // The columns that fit the room, two cells apart; the rest are counted.
    let used = 0
    let shown = 0
    for (const columnWidth of widths) {
      if (shown > 0 && used + columnWidth + 2 > detailWidth) break
      used += columnWidth + 2
      shown += 1
    }
    const hidden = value.columns.length - shown

    const drawCells = (cells: (string | null)[], isHeader: boolean) => (
      <Box flexDirection="row">
        {cells.slice(0, shown).map((cell, index) => (
          <Box width={(widths[index] ?? CELL_MAX) + 2}>
            <Text
              mono
              tabular
              wrap="truncate-end"
              dimColor={isHeader || cell === null}
              italic={cell === null}
              weight={isHeader ? 'medium' : 'regular'}
            >
              {cellText(cell)}
            </Text>
          </Box>
        ))}
      </Box>
    )

    const summary = [
      value.rows.length < value.limit ? `${value.rows.length} rows` : `first ${value.limit} rows`,
      `${value.ms} ms`,
      'read-only',
    ]
    if (hidden > 0) summary.push(`${hidden} more column${hidden === 1 ? '' : 's'} to the right`)

    return (
      <Box flexDirection="column">
        {drawCells(value.columns, true)}
        {value.rows.length === 0 && <Text dimColor>No rows.</Text>}
        {value.rows.map(row => drawCells(row, false))}
        <Text dimColor size="footnote">
          {summary.join(' · ')}
        </Text>
      </Box>
    )
  }

  const body = isWide ? (
    <Box flexDirection="row" gap={3}>
      {tree}
      {detail}
    </Box>
  ) : (
    <Box flexDirection="column" gap={1}>
      {tree}
      {detail}
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1}>
      {header}
      {notice}
      {view.catalog !== null && body}
    </Box>
  )
}

function flagsOf(column: DbColumn): string {
  const flags: string[] = []
  if (column.isPrimaryKey) flags.push('primary key')
  if (column.references) flags.push(`→ ${column.references}`)
  if (column.notNull && !column.isPrimaryKey) flags.push('not null')
  if (column.default && !column.default.startsWith('nextval(')) flags.push(`default ${column.default}`)

  return flags.join(' · ')
}

function cellText(cell: string | null): string {
  if (cell === null) return 'NULL'

  return cell.replace(/\r?\n/g, '↵').replace(/\t/g, ' ')
}

function compact(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 100) / 10}k`

  return `${Math.round(n / 100_000) / 10}M`
}
