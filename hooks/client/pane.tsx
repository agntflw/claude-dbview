import type { ElementConstructor, Elements, RenderElement } from 'claude-code'

import type {
  DbCatalog,
  DbColumn,
  DbConstraint,
  DbIndex,
  DbPreview,
  DbRef,
  DbRelation,
  DbRelationDetail,
  DbSchema,
  DbSource,
  DbTab,
  DbView,
} from '../../types'
import { ROW_LIMITS } from './actions'
import type { Actions } from './actions'
import { COLOR, SPACER_SVG, glyphOf, lineSvg, tileSvg } from './icons'
import type { IconName } from './icons'
import { folderId, relationId, relationKey, schemaId, sourceId } from './state'

// The client side: draws the pane from the view, on whichever surface asks.
// Tree on the left (data source, schema, kind folder, object, column) and the
// open object on the right, as the Claude desktop sidebar sits beside its
// content; stacked when the pane is narrow. Nothing here reaches a database.

type Table = Elements['terminal']

export type PaneInput = {
  els: Pick<Table, 'Box' | 'Text' | 'Button' | 'Code'>
  /** The surface's text field and picker, where it has them (not mobile). */
  Input?: Table['Input']
  Select?: Table['Select']
  /** The surface's SVG image, where it has one (not the terminal). */
  Svg?: ElementConstructor<{ source: string; alt: string; width?: number; height?: number }>
  width: number
  view: DbView
  act: Actions
  /** Puts text on the clipboard of the surface drawing the pane. */
  copy: (text: string) => void
}

const WIDE_AT = 80
const TREE_COLUMNS = 40
const CELL_MAX = 24

type Row = {
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

const KIND_WORD: Record<DbRelation['kind'], string> = {
  table: 'table',
  partitioned: 'partitioned table',
  foreign: 'foreign table',
  view: 'view',
  matview: 'materialized view',
  sequence: 'sequence',
}

const TABS: { id: DbTab; label: string; hotkey: string }[] = [
  { id: 'columns', label: 'Columns', hotkey: 'c' },
  { id: 'rows', label: 'Rows', hotkey: 'w' },
  { id: 'ddl', label: 'DDL', hotkey: 'd' },
]

const CONSTRAINT_ICON: Record<DbConstraint['kind'], IconName> = {
  primary: 'key',
  unique: 'index',
  foreign: 'link',
  check: 'check',
  exclusion: 'check',
  trigger: 'check',
  notnull: 'notnull',
}

export function drawPane({ els, Input, Select, Svg, width, view, act, copy }: PaneInput): RenderElement {
  const { Box, Text, Button, Code } = els
  const isWide = width >= WIDE_AT
  const treeWidth = isWide ? Math.min(TREE_COLUMNS, Math.floor(width * 0.45)) : width
  const detailWidth = isWide ? width - treeWidth - 3 : width

  const line = (name: IconName, color?: string) =>
    Svg ? <Svg source={lineSvg(name, color)} alt={name} width={16} height={16} /> : <Text dimColor>{glyphOf(name)}</Text>
  const tile = (name: IconName, size: number) =>
    Svg ? <Svg source={tileSvg(name, size)} alt={name} width={size} height={size} /> : <Text color={COLOR.muted}>{glyphOf(name)}</Text>
  const spacer = () => (Svg ? <Svg source={SPACER_SVG} alt="" width={16} height={16} /> : <Text> </Text>)
  // Rounded outlines on the graphical surfaces. The terminal pane drops what a
  // bordered Box holds, so there the same parts stand unframed.
  const frame = Svg ? ({ borderStyle: 'round', borderColor: COLOR.border, backgroundColor: COLOR.ground, paddingX: 1 } as const) : {}
  const accentOf = (name: IconName) => (name === 'key' ? '#e0a94e' : name === 'link' ? '#6aa6ee' : undefined)

  const dotOf = (state: Row['dot']) =>
    state === 'connected' ? (
      <Text color={COLOR.connected}>●</Text>
    ) : state === 'error' ? (
      <Text color="error">●</Text>
    ) : (
      <Text dimColor>○</Text>
    )
  const stateOf = (source: DbSource): Row['dot'] =>
    view.status[source.id]?.phase === 'error' ? 'error' : view.catalogs[source.id] ? 'connected' : 'idle'

  // The switcher, atop the tree: which database is in front, a picker over
  // every source, where it lives, whether it answers; refresh beside it.
  const shown = shownSource(view)
  const shownCatalog = shown ? view.catalogs[shown.id] : undefined
  const where = shown
    ? [shown.port ? `${shown.host}:${shown.port}` : shown.host, shownCatalog ? `PG ${major(shownCatalog.version)}` : shown.origin === 'docker' ? 'docker' : '']
        .filter(Boolean)
        .join(' · ')
    : ''
  const picker =
    Select && view.sources.length > 1 ? (
      <Select
        key="source"
        value={shown?.id}
        options={view.sources.map(one => ({ value: one.id, label: one.label }))}
        onSelect={value => void act.pickSource(value)}
      />
    ) : (
      <Text weight="medium" wrap="truncate-end">
        {shown ? shown.label : 'Database'}
      </Text>
    )
  const switcher = (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      gap={1}
      width={isWide ? treeWidth : width}
      {...frame}
    >
      <Box flexDirection="row" gap={1} alignItems="center" flexShrink={1}>
        {tile('database', 20)}
        {picker}
        <Text dimColor size="footnote" wrap="truncate-end">
          {where}
        </Text>
        {shown && dotOf(stateOf(shown))}
      </Box>
      <Button key="refresh" label={Svg ? 'Refresh' : '↻'} hotkey="r" plain dimColor onPress={() => void act.refresh()} />
    </Box>
  )

  const notice = (() => {
    if (view.sourcesStatus.phase === 'loading' && view.sources.length === 0) return <Text dimColor>Looking for databases…</Text>
    if (view.sourcesStatus.phase === 'error') return <Text color="error">{view.sourcesStatus.error}</Text>
    if (view.sources.length === 0) {
      return (
        <Box flexDirection="column">
          <Text>No database yet.</Text>
          <Text dimColor>/db connect postgres://user:password@host:5432/database, or start a Postgres container.</Text>
          <Button key="refresh" label="Look again" hotkey="r" plain dimColor onPress={() => void act.refresh()} />
        </Box>
      )
    }

    return false
  })()

  const filter = view.filter.trim().toLowerCase()
  const rows = view.sources.flatMap(source => sourceRows(source))

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
      dot: stateOf(source),
      isOpen,
      onPress: () => void act.toggleSource(source.id),
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
        onPress: () => void act.toggle(sid),
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
          onPress: () => void act.toggle(fid),
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
          onPress: () => void act.toggle(fid),
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
        onPress: () => void act.pressRelation(ref),
      },
    ]
    if (!isOpen) return out

    const known = view.relations[relationKey(source, schema.name, relation.name)]?.columns
    if (!known) return [...out, { key: `${rid}:loading`, depth: 4, icon: 'column', label: '…' }]

    return [
      ...out,
      ...known.map(column => ({
        key: `${rid}:${column.name}`,
        depth: 4,
        icon: (column.isPrimaryKey ? 'key' : column.references ? 'link' : 'column') as IconName,
        label: column.name,
        meta: column.type,
        isMono: true,
      })),
    ]
  }

  const drawRow = (row: Row) => {
    const chevron = row.isOpen === undefined ? spacer() : line(row.isOpen ? 'chevronDown' : 'chevronRight')
    const accent = accentOf(row.icon)
    const icon = accent ? line(row.icon, accent) : row.isTile ? tile(row.icon, 20) : line(row.icon)
    const isGroup = row.depth === 1
    const name = row.isError ? (
      <Text color="error">{row.label}</Text>
    ) : row.isSelected ? (
      <Text weight="semibold" color={Svg ? undefined : 'claude'}>
        {row.label}
      </Text>
    ) : isGroup ? (
      <Text dimColor weight="medium">
        {row.label}
      </Text>
    ) : row.depth === 0 ? (
      <Text weight="semibold">{row.label}</Text>
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
        <Box flexDirection="row" gap={1} alignItems="center">
          {row.meta ? (
            <Text dimColor mono={row.isMono} size="footnote" wrap="truncate-end">
              {row.meta}
            </Text>
          ) : (
            ''
          )}
          {row.dot && dotOf(row.dot)}
        </Box>
      </Box>
    )
  }

  const filterField =
    Input && view.sources.length > 0 ? (
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

  const tree = (
    <Box flexDirection="column" gap={1} width={isWide ? treeWidth : undefined}>
      {switcher}
      {filterField}
      <Box flexDirection="column">
        {rows.map(drawRow)}
        {filter !== '' && rows.every(row => row.depth === 0) && <Text dimColor>Nothing matches “{view.filter}”.</Text>}
      </Box>
    </Box>
  )

  const detail = view.selected ? drawDetail(view.selected) : false

  // A rounded track of text buttons, the chosen one filled: the tabs, the row limit.
  function track<T extends string | number>(
    items: { id: T; label: string; key: string; hotkey?: string }[],
    chosen: T,
    pick: (id: T) => void,
    isMono = false,
  ) {
    return (
      <Box flexDirection="row" gap={Svg ? 0 : 2} flexShrink={0} {...frame}>
        {items.map(one => (
          <Box paddingX={Svg ? 1 : 0} backgroundColor={one.id === chosen && Svg ? COLOR.pill : undefined}>
            <Button key={one.key} plain hotkey={one.hotkey} onPress={() => pick(one.id)}>
              {one.id === chosen ? (
                <Text weight="medium" mono={isMono} color={Svg ? COLOR.text : 'claude'}>
                  {one.label}
                </Text>
              ) : (
                <Text dimColor mono={isMono}>
                  {one.label}
                </Text>
              )}
            </Button>
          </Box>
        ))}
      </Box>
    )
  }

  function drawDetail(ref: DbRef) {
    const relation = view.catalogs[ref.source]?.schemas
      .find(schema => schema.name === ref.schema)
      ?.relations.find(one => one.name === ref.name)
    const known = view.relations[relationKey(ref.source, ref.schema, ref.name)]
    const facts: string[] = []
    if (relation?.rows != null) facts.push(`${compact(relation.rows)} rows`)
    if (known) facts.push(`${known.columns.length} columns`)
    else facts.push(KIND_WORD[ref.kind])
    facts.push(ref.schema)
    if (view.sources.length > 1) facts.push(view.sources.find(one => one.id === ref.source)?.label ?? ref.source)
    const tabs = ref.kind === 'sequence' ? TABS.filter(one => one.id === 'ddl') : TABS

    const section = (() => {
      if (view.detailStatus.phase === 'error') return <Text color="error">{view.detailStatus.error}</Text>
      if (view.tab === 'columns' && known) return drawStructure(known)
      if (view.tab === 'rows' && view.preview) return drawRows(view.preview, relation?.rows ?? null)
      if (view.tab === 'ddl' && view.ddl !== null) return drawDdl(view.ddl)
      if (view.detailStatus.phase === 'loading') return <Text dimColor>Loading…</Text>

      return false
    })()

    const note =
      view.tab === 'columns' && known
        ? `${known.columns.length} columns · ${known.constraints.length} constraint${known.constraints.length === 1 ? '' : 's'}`
        : view.tab === 'ddl'
          ? 'generated from pg_catalog'
          : ''

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
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          {track(
            tabs.map(one => ({ id: one.id, label: one.label, key: `tab-${one.id}`, hotkey: one.hotkey })),
            view.tab,
            id => void act.setTab(id),
          )}
          <Text dimColor size="footnote" wrap="truncate-end">
            {note}
          </Text>
        </Box>
        {section}
      </Box>
    )
  }

  function sectionTitle(title: string, count: number) {
    return (
      <Box flexDirection="row" justifyContent="space-between">
        <Text dimColor weight="medium">
          {title}
        </Text>
        <Text dimColor size="footnote">
          {String(count)}
        </Text>
      </Box>
    )
  }

  function drawStructure(detail: DbRelationDetail) {
    const notNull = detail.columns.filter(column => column.notNull && !column.isPrimaryKey).map(column => column.name)

    return (
      <Box flexDirection="column" gap={1}>
        {drawColumns(detail.columns)}
        {(detail.constraints.length > 0 || notNull.length > 0) && drawConstraints(detail.constraints, notNull)}
        {detail.indexes.length > 0 && drawIndexes(detail.indexes)}
      </Box>
    )
  }

  function drawColumns(list: DbColumn[]) {
    // Name and type take what they need, up to a third of the room each.
    const room = Math.max(24, detailWidth - 3)
    const nameWidth = Math.min(Math.floor(room / 3), Math.max(4, ...list.map(column => column.name.length)) + 2)
    const typeWidth = Math.min(Math.floor(room / 3), Math.max(4, ...list.map(column => column.type.length)) + 2)
    const isRoomy = detailWidth >= 70
    const nullWidth = isRoomy ? 10 : 6

    const cells = (icon: RenderElement, name: RenderElement, type: RenderElement, nullable: RenderElement, key: RenderElement) => (
      <Box flexDirection="row" alignItems="center">
        <Box width={3} flexShrink={0}>
          {icon}
        </Box>
        <Box width={nameWidth} flexShrink={0}>
          {name}
        </Box>
        <Box width={typeWidth} flexShrink={0}>
          {type}
        </Box>
        <Box width={nullWidth} flexShrink={0}>
          {nullable}
        </Box>
        <Box flexShrink={1}>{key}</Box>
      </Box>
    )
    const head = (label: string) => (
      <Text dimColor size="footnote" weight="medium" wrap="truncate-end">
        {label}
      </Text>
    )

    return (
      <Box flexDirection="column">
        {cells(<Text> </Text>, head('Name'), head('Type'), head(isRoomy ? 'Nullable' : 'Null'), head('Key / reference'))}
        {list.map(column => {
          const icon: IconName = column.isPrimaryKey ? 'key' : column.references ? 'link' : 'column'
          const key = column.isPrimaryKey ? (
            <Text dimColor size="footnote" wrap="truncate-end">
              primary key
            </Text>
          ) : column.references ? (
            <Text mono size="footnote" color={COLOR.link} wrap="truncate-end">
              {`→ ${column.references}`}
            </Text>
          ) : (
            <Text> </Text>
          )

          return (
            <Box flexDirection="column">
              {cells(
                line(icon, accentOf(icon)),
                <Text mono wrap="truncate-end" weight={column.isPrimaryKey ? 'semibold' : 'regular'}>
                  {column.name}
                </Text>,
                <Text mono dimColor wrap="truncate-end">
                  {column.type}
                </Text>,
                <Text dimColor size="footnote">
                  {column.notNull ? 'no' : 'yes'}
                </Text>,
                key,
              )}
              {column.default !== null && (
                <Box paddingLeft={3}>
                  <Text mono dimColor size="footnote" wrap="truncate-end">
                    {`default ${column.default}`}
                  </Text>
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
  }

  /** One line of the Constraints or Indexes list: icon, name, definition. */
  function defLine(icon: IconName, name: string, definition: string, names: number) {
    const nameWidth = Math.min(Math.floor(detailWidth * 0.45), names + 2)

    return (
      <Box flexDirection="row" alignItems="center">
        <Box width={3} flexShrink={0}>
          {line(icon, accentOf(icon))}
        </Box>
        <Box width={nameWidth} flexShrink={0} paddingRight={1}>
          <Text mono wrap="truncate-end">
            {name}
          </Text>
        </Box>
        <Text mono dimColor wrap="truncate-end">
          {definition}
        </Text>
      </Box>
    )
  }

  function drawConstraints(list: DbConstraint[], notNull: string[]) {
    const nameWidth = Math.max(8, ...list.map(one => one.name.length))

    return (
      <Box flexDirection="column">
        {sectionTitle('Constraints', list.length + (notNull.length > 0 ? 1 : 0))}
        {list.map(one => defLine(CONSTRAINT_ICON[one.kind], one.name, one.definition.replace('REFERENCES ', '→ '), nameWidth))}
        {notNull.length > 0 && defLine('notnull', 'not null', notNull.join(', '), nameWidth)}
      </Box>
    )
  }

  function drawIndexes(list: DbIndex[]) {
    const nameWidth = Math.max(8, ...list.map(one => one.name.length))

    return (
      <Box flexDirection="column">
        {sectionTitle('Indexes', list.length)}
        {list.map(one => defLine('index', one.name, one.definition, nameWidth))}
      </Box>
    )
  }

  function drawDdl(source: string) {
    return (
      <Box flexDirection="column" {...frame}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" paddingX={1}>
          <Text dimColor size="footnote">
            SQL
          </Text>
          <Box flexDirection="row" gap={1} alignItems="center">
            {Svg && line('copy')}
            <Button key="copy" plain dimColor hotkey="y" onPress={() => copy(source)}>
              Copy
            </Button>
          </Box>
        </Box>
        <Box paddingX={1}>
          <Code source={source} language="sql" startLine={1} />
        </Box>
      </Box>
    )
  }

  function drawRows(value: DbPreview, estimate: number | null) {
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

    const total = value.rows.length < value.limit ? value.rows.length : estimate
    const range =
      total === null ? `showing ${value.rows.length}` : `${compact(Math.max(total, value.rows.length))} rows · showing ${value.rows.length}`

    const summary = [`${value.ms} ms`, 'read-only']
    if (hidden > 0) summary.push(`${hidden} more column${hidden === 1 ? '' : 's'} to the right`)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          <Text>{range}</Text>
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text dimColor size="footnote">
              Limit
            </Text>
            {track(
              ROW_LIMITS.map(one => ({ id: one, label: String(one), key: `limit-${one}` })),
              view.limit,
              id => void act.setLimit(id),
              true,
            )}
          </Box>
        </Box>
        <Text mono dimColor size="footnote" wrap="truncate-end">
          {value.query}
        </Text>
        <Box flexDirection="column">
          {drawCells(value.columns, true)}
          {value.rows.length === 0 && <Text dimColor>No rows.</Text>}
          {value.rows.map(row => drawCells(row, false))}
        </Box>
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
      {notice}
      {view.sources.length > 0 && body}
    </Box>
  )
}

/** The source the picker names: the one unfolded, else the open object's, else the first. */
function shownSource(view: DbView): DbSource | undefined {
  const open = view.sources.find(one => view.expanded.includes(sourceId(one.id)))

  return open ?? view.sources.find(one => one.id === view.selected?.source) ?? view.sources[0]
}

function sameRef(a: DbRef, b: DbRef): boolean {
  return a.source === b.source && a.schema === b.schema && a.name === b.name
}

/** `16.4 (Debian 16.4-1)` → `16`. */
function major(version: string): string {
  return version.split(/[ .]/)[0] ?? version
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
