import type { ElementConstructor, Elements, RenderElement } from 'claude-code'

import type {
  DbColumn,
  DbConstraint,
  DbPreview,
  DbRef,
  DbRelation,
  DbRelationDetail,
  DbRelationName,
  DbRowLimit,
  DbScroll,
  DbSource,
  DbTab,
  DbView,
} from '../../types'
import { ROW_LIMITS } from './actions'
import type { Actions } from './actions'
import { COLOR, SPACER_SVG, glyphOf, lineSvg, tileSvg } from './icons'
import type { IconName } from './icons'
import { EMPTY_SCROLL, relationKey, sourceId } from './state'
import { KIND_ICON, compact, listTree, stateOf } from './tree'
import type { Row } from './tree'

// The client side: draws the pane from the view, on whichever surface asks.
// Two panels, as the Claude desktop sidebar sits beside its content: the tree
// (data source, schema, kind folder, object, column) and the open object.
// Side by side when the pane is wide, stacked when it is narrow. On the
// terminal each panel scrolls on its own, in a window with its own bar. A
// graphical surface scrolls the pane's body itself before it asks, so there
// the panels stand at their whole height and the body scrolls as one. The
// open object moves across with its own bar on every surface.
// A foreign key is a link: a press opens the table it points at.
// Nothing here reaches a database.

type Table = Elements['terminal']

export type PaneInput = {
  els: Pick<Table, 'Box' | 'Text' | 'Button' | 'Code'>
  /** The surface's text field and picker, where it has them (not mobile). */
  Input?: Table['Input']
  Select?: Table['Select']
  /** The surface's SVG image, where it has one (not the terminal). */
  Svg?: ElementConstructor<{ source: string; alt: string; width?: number; height?: number }>
  /** The pane body, in cells across and rows down. */
  width: number
  height: number
  /** Graphical, wide: the body row the open object stands at, where the window was when it opened. */
  detailTop?: number
  view: DbView
  act: Actions
  /** Puts text on the clipboard of the surface drawing the pane. */
  copy: (text: string) => void
}

/** How far one part of the pane can move, and how much of it shows at once. */
export type Span = { max: number; page: number }

/** What the last drawing laid out: where a wheel over the body lands, and how far each part moves. */
export type PaneLayout = {
  isWide: boolean
  /** The panels stand at their whole height and the body's window scrolls them (a graphical surface). */
  isFlow: boolean
  /** Wide: the tree's columns from the left edge. Stacked: the tree's rows from the top. */
  split: number
  /** The body row from which a wheel over the open object moves it across (its bar's row). */
  across: number
  tree: Span
  detail: Span
  left: Span
  /** The rows the open object's panel takes, about, where it stands whole (none open: 0). */
  objectRows: number
  /** The object and tab the detail's offsets belong to. */
  for: string
}

export type PaneDrawing = { element: RenderElement; layout: PaneLayout }

const WIDE_AT = 84
const TREE_SHARE = 0.3
const TREE_MIN = 32
const TREE_MAX = 52
const CELL_MAX = 40

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

export function drawPane({ els, Input, Select, Svg, width, height, detailTop = 0, view, act, copy }: PaneInput): PaneDrawing {
  const { Box, Text, Button, Code } = els
  const isGraphic = Svg !== undefined
  // A graphical surface moves the body's window first and asks after, so a
  // window drawn inside the panels fought it and the pane jumped back on every
  // tick: there the panels stand whole and the window is the scroll.
  const isFlow = isGraphic

  // The room. Wide: tree at the left, a share of the width within bounds, the
  // open object takes the rest. Narrow: the tree on top, the object below.
  const isWide = width >= WIDE_AT
  const hasDetail = view.selected !== null
  const bodyRows = Math.max(16, height - 1)
  const treeCols = isWide ? clamp(Math.round(width * TREE_SHARE), TREE_MIN, TREE_MAX) : width
  const detailCols = isWide ? width - treeCols - 1 : width
  const treeRows = isWide || !hasDetail ? bodyRows : clamp(Math.round(bodyRows * 0.4), 8, Math.max(8, bodyRows - 16))
  const detailRows = isWide ? bodyRows : bodyRows - treeRows - 1

  // A panel: rounded, a step darker than the pane, on the graphical surfaces.
  // The terminal pane drops what a bordered Box holds, so there the same
  // parts stand unframed. A graphical border is a pixel, not a cell: what a
  // frame costs is counted in its padding, a cell a side, and about a row.
  const edgeRows = isGraphic ? 1 : 0
  const padCols = isGraphic ? 2 : 0
  const panel = isGraphic ? ({ borderStyle: 'round', borderColor: COLOR.border, backgroundColor: COLOR.panel, paddingX: 1 } as const) : {}
  const well = isGraphic ? ({ borderStyle: 'round', borderColor: COLOR.border, backgroundColor: COLOR.well, paddingX: 1 } as const) : {}
  const frame = isGraphic ? ({ borderStyle: 'round', borderColor: COLOR.border, backgroundColor: COLOR.ground, paddingX: 1 } as const) : {}
  const framedRows = isGraphic ? 2 : 1
  // A rounded pill behind a chosen item, a fainter one under the pointer: a
  // Box's corners round only with a border, so each item has one in the
  // colour of what it sits on until it is chosen. Hotkeys stay on the
  // terminal; a graphical surface draws them as chips that crowd the pills.
  const pill = (key: string, isOn: boolean, ground: string) =>
    isGraphic
      ? ({
          key: `${key}:pill`,
          borderStyle: 'round',
          borderColor: isOn ? COLOR.pill : ground,
          backgroundColor: isOn ? COLOR.pill : undefined,
          hover: isOn ? undefined : { borderColor: COLOR.hover, backgroundColor: COLOR.hover },
        } as const)
      : {}
  // A tree row is filled without a border: a graphical border pads its Box
  // and spreads the rows apart.
  const rowFill = (key: string, isOn: boolean) =>
    isGraphic
      ? ({ key: `${key}:fill`, backgroundColor: isOn ? COLOR.pill : undefined, hover: isOn ? undefined : { backgroundColor: COLOR.hover } } as const)
      : {}
  const strip = isGraphic ? ({ borderStyle: 'round', borderColor: COLOR.strip, backgroundColor: COLOR.strip } as const) : {}
  const keyOf = (hotkey: string) => (isGraphic ? undefined : hotkey)

  const line = (name: IconName, color?: string) =>
    Svg ? <Svg source={lineSvg(name, color)} alt={name} width={16} height={16} /> : <Text dimColor>{glyphOf(name)}</Text>
  const tile = (name: IconName, size: number) =>
    Svg ? <Svg source={tileSvg(name, size)} alt={name} width={size} height={size} /> : <Text color={COLOR.muted}>{glyphOf(name)}</Text>
  const spacer = () => (Svg ? <Svg source={SPACER_SVG} alt="" width={16} height={16} /> : <Text> </Text>)
  const accentOf = (name: IconName) => (name === 'key' ? '#e0a94e' : name === 'link' ? '#6aa6ee' : undefined)
  const blank = () => <Text> </Text>

  const dotOf = (state: Row['dot']) =>
    state === 'connected' ? (
      <Text color={COLOR.connected}>●</Text>
    ) : state === 'error' ? (
      <Text color="error">●</Text>
    ) : (
      <Text dimColor>○</Text>
    )
  // A foreign key leads to its table, as a link would, but looks like the
  // text around it: the same Text, only pressable. The terminal wraps a
  // Button's label that meets the panel's edge, so there it is held to one row.
  const link = (key: string, text: RenderElement, source: string, to: DbRelationName) => (
    <Box flexShrink={1} overflow="hidden" height={isGraphic ? undefined : 1}>
      <Button key={key} plain onPress={() => void act.jump({ source, ...to })}>
        {text}
      </Button>
    </Box>
  )

  const detailFor = detailForOf(view)
  const scroll = scrollOf(view, detailFor)

  // A vertical bar beside a scrolled part: a track, the thumb sized to what
  // shows, a step up and down at its ends. Only while there is more. Every
  // cell of the track is a press that brings that part of the list into view.
  function vbar(id: string, offset: number, span: Span, shown: number, move: (to: number) => void) {
    if (span.max <= 0) return false
    const step = Math.max(1, Math.floor(span.page / 2))
    const track = Math.max(1, shown - 2)
    const thumb = clamp(Math.round((track * span.page) / (span.max + span.page)), 1, track)
    const from = Math.round(((track - thumb) * offset) / span.max)
    const at = (index: number) => Math.round((span.max * index) / Math.max(1, track - 1))

    return (
      <Box flexDirection="column" alignItems="center" flexShrink={0} width={1} overflow="hidden">
        <Button key={`${id}-up`} plain onPress={() => move(Math.max(0, offset - step))}>
          <Text color={COLOR.muted}>{isGraphic ? '▲' : '▴'}</Text>
        </Button>
        {Array.from({ length: track }, (_, index) => (
          <Button key={`${id}-at-${index}`} plain onPress={() => move(at(index))}>
            {index >= from && index < from + thumb ? (
              <Text mono color={isGraphic ? COLOR.thumb : COLOR.muted}>
                ┃
              </Text>
            ) : (
              <Text mono color={isGraphic ? COLOR.track : undefined} dimColor={!isGraphic}>
                │
              </Text>
            )}
          </Button>
        ))}
        <Button key={`${id}-down`} plain onPress={() => move(Math.min(span.max, offset + step))}>
          <Text color={COLOR.muted}>{isGraphic ? '▼' : '▾'}</Text>
        </Button>
      </Box>
    )
  }

  // The bar under the open object's section, when it is wider than the room.
  function hbar(offset: number, span: Span, cols: number, move: (to: number) => void) {
    if (span.max <= 0) return false
    const step = Math.max(4, Math.floor(span.page / 2))
    const track = Math.max(4, cols - 4)
    const thumb = clamp(Math.round((track * span.page) / (span.max + span.page)), 2, track)
    const from = Math.round(((track - thumb) * offset) / span.max)

    return (
      <Box flexDirection="row" gap={1} alignItems="center" flexShrink={0} overflow="hidden">
        <Button key="detail-left" plain dimColor onPress={() => move(Math.max(0, offset - step))}>
          ◂
        </Button>
        <Text mono wrap="truncate-end">
          <Text color={COLOR.track}>{'━'.repeat(from)}</Text>
          <Text color={COLOR.thumb}>{'━'.repeat(thumb)}</Text>
          <Text color={COLOR.track}>{'━'.repeat(track - from - thumb)}</Text>
        </Text>
        <Button key="detail-right" plain dimColor onPress={() => move(Math.min(span.max, offset + step))}>
          ▸
        </Button>
      </Box>
    )
  }

  // The switcher, atop the tree: which database is in front, a picker over
  // every source, where it lives, whether it answers; refresh beside it. The
  // name keeps its room; where it lives gives way first.
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
      <Text weight="medium">{shown ? shown.label : 'Database'}</Text>
    )
  const switcher = (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} flexShrink={0} overflow="hidden" {...frame}>
      <Box flexDirection="row" gap={1} alignItems="center" flexShrink={1} overflow="hidden">
        {tile('database', 20)}
        <Box flexShrink={0}>{picker}</Box>
        <Box flexShrink={1} overflow="hidden">
          <Text dimColor size="footnote" wrap="truncate-end">
            {where}
          </Text>
        </Box>
        {shown && dotOf(stateOf(view, shown))}
      </Box>
      <Box flexShrink={0}>
        <Button key="refresh" label={Svg ? 'Refresh' : '↻'} hotkey={keyOf('r')} plain dimColor onPress={() => void act.refresh()} />
      </Box>
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
          <Button key="refresh" label="Look again" hotkey={keyOf('r')} plain dimColor onPress={() => void act.refresh()} />
        </Box>
      )
    }

    return false
  })()

  const filter = view.filter.trim().toLowerCase()
  const rows = listTree(view, act)

  // A tree row. The name keeps its room and the count or type at the right
  // gives way first; what still does not fit is cut at the panel's edge.
  const drawRow = (row: Row) => {
    // The chevron folds the row too: a press of its own, as the name is, in
    // the thin glyph of the line icon it stands for.
    const chevron = (
      <Box width={2} flexShrink={0}>
        {row.isOpen === undefined ? (
          spacer()
        ) : row.onPress ? (
          <Button key={`${row.key}:fold`} plain onPress={row.onPress}>
            <Text color={COLOR.muted}>{glyphOf(row.isOpen ? 'chevronDown' : 'chevronRight')}</Text>
          </Button>
        ) : (
          line(row.isOpen ? 'chevronDown' : 'chevronRight')
        )}
      </Box>
    )
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
        gap={1}
        paddingLeft={row.depth * 2}
        paddingRight={1}
        flexShrink={0}
        overflow="hidden"
        {...rowFill(row.key, row.isSelected === true)}
      >
        <Box flexDirection="row" gap={1} alignItems="center" flexShrink={0}>
          {chevron}
          {icon}
          {row.onPress ? (
            <Button key={row.key} plain onPress={row.onPress}>
              {name}
            </Button>
          ) : (
            <Text>{name}</Text>
          )}
        </Box>
        <Box flexDirection="row" gap={1} alignItems="center" flexShrink={1} overflow="hidden">
          {row.meta ? (
            <Text dimColor mono={row.isMono} size={row.isMono ? undefined : 'footnote'} wrap="truncate-end">
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
      <Box flexDirection="row" gap={1} alignItems="center" flexShrink={0}>
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

  // The tree panel: switcher, filter, then the rows, in a window of their own
  // on the terminal, all of them where the body scrolls.
  const filterRows = filterField ? (isGraphic ? 2 : 1) + 1 : 0
  const treeFit = isFlow ? rows.length : Math.max(3, treeRows - edgeRows - framedRows - 1 - filterRows)
  const tree: Span = { max: Math.max(0, rows.length - treeFit), page: treeFit }
  const treeTop = Math.min(scroll.tree, tree.max)
  const treeShown = rows.slice(treeTop, treeTop + treeFit)
  const moveTree = (to: number) => void act.setScroll({ ...scroll, tree: to })
  // Where the body scrolls, a panel is at least the room it had and grows past it.
  const rowsOf = (rows: number) => (isFlow ? { minHeight: rows } : { height: rows })
  // Stacked where the body scrolls, the open object stands under the row
  // that opened it, its own rows included, so it opens in view; the rest of
  // the tree follows it.
  const isSplit = isFlow && !isWide && hasDetail
  const selectedAt = treeShown.findIndex(row => row.isSelected)
  let splitAt = selectedAt < 0 ? treeShown.length : selectedAt + 1
  while (selectedAt >= 0 && splitAt < treeShown.length && (treeShown[splitAt]?.depth ?? 0) > (treeShown[selectedAt]?.depth ?? 0)) splitAt++
  const treeHead = isSplit ? treeShown.slice(0, splitAt) : treeShown
  const treeTail = isSplit ? treeShown.slice(splitAt) : []
  const treeRoom = isSplit ? 0 : treeRows

  const treePanel = (
    <Box flexDirection="column" gap={1} width={treeCols} {...rowsOf(treeRoom)} flexShrink={0} overflow="hidden" {...panel}>
      {switcher}
      {filterField}
      <Box flexDirection="row" gap={1} flexGrow={1} minHeight={0} overflow="hidden">
        <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
          {treeHead.map(drawRow)}
          {filter !== '' && rows.every(row => row.depth === 0) && <Text dimColor>Nothing matches “{view.filter}”.</Text>}
        </Box>
        {vbar('tree', treeTop, tree, treeFit, moveTree)}
      </Box>
    </Box>
  )

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
          <Box paddingX={Svg ? 1 : 0} {...pill(one.key, one.id === chosen, COLOR.ground)}>
            <Button key={one.key} plain hotkey={one.hotkey && keyOf(one.hotkey)} onPress={() => pick(one.id)}>
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

  // The open object's section as lines, one row each, so the panel can show
  // a window of them; and the cells it takes across, so it can move sideways.
  type Section = { lines: RenderElement[]; cols: number; toolbar?: RenderElement; toolbarRows: number; code?: string }

  // The section's room: the panel less its padding, the well's, the bar and its gap.
  const sectionCols = Math.max(20, detailCols - padCols - padCols - 2)

  function columnsSection(detail: DbRelationDetail, ref: DbRef): Section {
    const columns = detail.columns
    const notNull = columns.filter(column => column.notNull && !column.isPrimaryKey).map(column => column.name)
    const keyOf = (column: DbColumn) => (column.isPrimaryKey ? 'primary key' : column.references ? `→ ${column.references}` : '')
    const nameWidth = Math.max(4, ...columns.map(column => column.name.length)) + 2
    const typeWidth = Math.max(4, ...columns.map(column => column.type.length)) + 2
    const nullWidth = 10
    const keyWidth = Math.max('Key / reference'.length, ...columns.map(column => keyOf(column).length)) + 1
    /** A line of a list; `key` names its link, where it leads somewhere. */
    type Def = { icon: IconName; name: string; text: string; key?: string; to?: DbRelationName | null }
    const defs: Def[] = [
      ...detail.constraints.map(one => ({
        icon: CONSTRAINT_ICON[one.kind],
        name: one.name,
        text: one.definition.replace('REFERENCES ', '→ '),
        key: `fk-def-${one.name}`,
        to: one.target,
      })),
      ...(notNull.length > 0 ? [{ icon: 'notnull' as IconName, name: 'not null', text: notNull.join(', ') }] : []),
    ]
    const indexes: Def[] = detail.indexes.map(one => ({ icon: 'index', name: one.name, text: one.definition }))
    // The other end of the keys: who points here, each a press away.
    const backlinks: Def[] = (detail.referencedBy ?? []).map(one => ({
      icon: 'link',
      name: one.constraint,
      text: `← ${one.schema}.${one.name}(${one.columns.join(', ')})`,
      key: `ref-by-${one.schema}.${one.name}.${one.constraint}`,
      to: { schema: one.schema, name: one.name },
    }))
    const listed = [...defs, ...indexes, ...backlinks]
    const defName = Math.max(8, ...listed.map(one => one.name.length)) + 2
    const cols = Math.max(
      3 + nameWidth + typeWidth + nullWidth + keyWidth,
      ...columns.map(column => (column.default === null ? 0 : 3 + 8 + column.default.length)),
      ...listed.map(one => 3 + defName + one.text.length),
    )

    const cells = (icon: RenderElement, name: RenderElement, type: RenderElement, nullable: RenderElement, key: RenderElement, isHead = false) => (
      <Box flexDirection="row" alignItems="center" {...(isHead ? strip : {})}>
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
        <Box width={keyWidth} flexShrink={0}>
          {key}
        </Box>
      </Box>
    )
    const head = (label: string) => (
      <Text dimColor size="footnote" weight="medium">
        {label}
      </Text>
    )
    const title = (label: string, count: number) => (
      <Box flexDirection="row" justifyContent="space-between" width={cols} {...strip}>
        <Text dimColor weight="medium">
          {` ${label}`}
        </Text>
        <Text dimColor size="footnote">
          {`${count} `}
        </Text>
      </Box>
    )
    // The text as is, pressable where it names a table to go to.
    const withLink = (key: string, text: RenderElement, to: DbRelationName | null | undefined) => (to ? link(key, text, ref.source, to) : text)

    // A line of a list; one that leads to another table is pressable, drawn the same.
    const defLine = (one: Def) => {
      const plain = (
        <Text mono dimColor wrap="truncate-end">
          {one.text}
        </Text>
      )
      const text = one.key ? withLink(one.key, plain, one.to) : plain

      return (
        <Box flexDirection="row" alignItems="center">
          <Box width={3} flexShrink={0}>
            {line(one.icon, accentOf(one.icon))}
          </Box>
          <Box width={defName} flexShrink={0}>
            <Text mono wrap="truncate-end">
              {one.name}
            </Text>
          </Box>
          <Box width={one.text.length + 1} flexShrink={0}>
            {text}
          </Box>
        </Box>
      )
    }

    const lines: RenderElement[] = [cells(<Text> </Text>, head('Name'), head('Type'), head('Nullable'), head('Key / reference'), true)]
    for (const column of columns) {
      const icon: IconName = column.isPrimaryKey ? 'key' : column.references ? 'link' : 'column'
      const key = column.isPrimaryKey ? (
        <Text dimColor size="footnote" wrap="truncate-end">
          primary key
        </Text>
      ) : column.references ? (
        withLink(
          `fk-${column.name}`,
          <Text mono size="footnote" color={COLOR.link} wrap="truncate-end">
            {`→ ${column.references}`}
          </Text>,
          column.target,
        )
      ) : (
        <Text> </Text>
      )
      lines.push(
        cells(
          line(icon, accentOf(icon)),
          <Text mono weight={column.isPrimaryKey ? 'semibold' : 'regular'}>
            {column.name}
          </Text>,
          <Text mono dimColor>
            {column.type}
          </Text>,
          <Text dimColor size="footnote">
            {column.notNull ? 'no' : 'yes'}
          </Text>,
          key,
        ),
      )
      if (column.default !== null) {
        lines.push(
          <Box paddingLeft={3} flexDirection="row" gap={1} width={cols}>
            <Text dimColor size="caption">
              default
            </Text>
            <Text mono dimColor size="footnote" wrap="truncate-end">
              {column.default}
            </Text>
          </Box>,
        )
      }
    }
    if (defs.length > 0) lines.push(blank(), title('Constraints', defs.length), ...defs.map(defLine))
    if (indexes.length > 0) lines.push(blank(), title('Indexes', indexes.length), ...indexes.map(defLine))
    if (backlinks.length > 0) lines.push(blank(), title('Referenced by', backlinks.length), ...backlinks.map(defLine))

    return { lines, cols, toolbarRows: 0 }
  }

  function rowsSection(value: DbPreview, estimate: number | null): Section {
    const widths = value.columns.map((name, index) =>
      Math.min(CELL_MAX, Math.max(name.length, ...value.rows.map(row => cellText(row[index] ?? null).length))),
    )
    const gridCols = widths.reduce((sum, one) => sum + one + 2, 0)

    const drawCells = (cells: (string | null)[], isHeader: boolean) => (
      <Box flexDirection="row" {...(isHeader ? strip : {})}>
        {cells.map((cell, index) => (
          <Box width={(widths[index] ?? CELL_MAX) + 2} flexShrink={0}>
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
    const summary = `${value.ms} ms · read-only · ${value.columns.length} column${value.columns.length === 1 ? '' : 's'}`

    const toolbar = (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} flexShrink={0} flexWrap="wrap">
        <Text>{range}</Text>
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text dimColor size="footnote">
            Limit
          </Text>
          {limitStepper()}
        </Box>
      </Box>
    )

    const lines: RenderElement[] = [
      <Text mono dimColor size="footnote" wrap="truncate-end">
        {value.query}
      </Text>,
      blank(),
      drawCells(value.columns, true),
      ...(value.rows.length === 0 ? [<Text dimColor>No rows.</Text>] : value.rows.map(row => drawCells(row, false))),
      blank(),
      <Text dimColor size="footnote">
        {summary}
      </Text>,
    ]

    return { lines, cols: Math.max(gridCols, value.query.length, summary.length), toolbar, toolbarRows: framedRows }
  }

  // One number between two steps, through the presets: the cleanest the
  // pane can draw, as it has no drag. A step at the end of the range dims.
  function limitStepper() {
    const at = ROW_LIMITS.indexOf(view.limit)
    const less = ROW_LIMITS[at - 1]
    const more = ROW_LIMITS[at + 1]
    const step = (key: string, glyph: string, to: DbRowLimit | undefined) =>
      to === undefined ? (
        <Text color={COLOR.border}>{glyph}</Text>
      ) : (
        <Button key={key} plain onPress={() => void act.setLimit(to)}>
          <Text color={COLOR.muted}>{glyph}</Text>
        </Button>
      )

    return (
      <Box flexDirection="row" gap={1} alignItems="center" flexShrink={0} {...frame}>
        {step('limit-less', '‹', less)}
        <Box width={4} justifyContent="center">
          <Text mono weight="medium" tabular>
            {String(view.limit)}
          </Text>
        </Box>
        {step('limit-more', '›', more)}
      </Box>
    )
  }

  // The DDL. A graphical surface's code block carries its own frame and copy
  // button, so there it stands alone; the terminal's has neither.
  function ddlSection(source: string): Section {
    const sourceLines = source.split('\n')
    const gutter = String(sourceLines.length).length + 2
    const toolbar = isGraphic ? undefined : (
      <Box flexDirection="row" justifyContent="flex-end" alignItems="center" flexShrink={0}>
        <Button key="copy" plain dimColor hotkey="y" onPress={() => copy(source)}>
          Copy
        </Button>
      </Box>
    )

    return {
      lines: sourceLines.map(one => <Text wrap="truncate-end">{one}</Text>),
      cols: gutter + Math.max(...sourceLines.map(one => one.length)) + 1,
      toolbar,
      toolbarRows: toolbar ? 1 : 0,
      code: source,
    }
  }

  let detailSpan: Span = { max: 0, page: 1 }
  let objectRows = 0
  let leftSpan: Span = { max: 0, page: sectionCols }

  function detailPanel(ref: DbRef) {
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

    const section: Section | undefined = (() => {
      if (view.detailStatus.phase === 'error') return { lines: [<Text color="error">{view.detailStatus.error}</Text>], cols: 0, toolbarRows: 0 }
      if (view.tab === 'columns' && known) return columnsSection(known, ref)
      if (view.tab === 'rows' && view.preview) return rowsSection(view.preview, relation?.rows ?? null)
      if (view.tab === 'ddl' && view.ddl !== null) return ddlSection(view.ddl)
      if (view.detailStatus.phase === 'loading') return { lines: [<Text dimColor>Loading…</Text>], cols: 0, toolbarRows: 0 }

      return undefined
    })()

    const note =
      view.tab === 'columns' && known
        ? `${known.columns.length} columns · ${known.constraints.length} constraint${known.constraints.length === 1 ? '' : 's'}`
        : view.tab === 'ddl'
          ? 'SQL · generated from pg_catalog'
          : ''

    // Rows down: the panel less its frame, the title's two, the tabs, the
    // toolbar, the well's frame and the bar across; each with its gap.
    const lines = section?.lines ?? []
    const leftMax = Math.max(0, (section?.cols ?? 0) - sectionCols)
    const toolbarRows = section?.toolbar ? section.toolbarRows + 1 : 0
    const chrome = edgeRows + 2 + 1 + framedRows + 1 + toolbarRows + edgeRows + (leftMax > 0 ? 1 : 0)
    objectRows = Math.max(detailRows, lines.length + chrome)
    const fit = isFlow ? lines.length : Math.max(3, detailRows - chrome)
    detailSpan = { max: Math.max(0, lines.length - fit), page: fit }
    leftSpan = { max: leftMax, page: sectionCols }
    const top = Math.min(scroll.detail, detailSpan.max)
    const left = Math.min(scroll.left, leftSpan.max)
    const moveDown = (to: number) => void act.setScroll({ ...scroll, detail: to })
    const moveAcross = (to: number) => void act.setScroll({ ...scroll, left: to })

    // Code keeps its gutter in place: its lines are cut at the left instead.
    const content = section?.code ? (
      <Code
        source={section.code
          .split('\n')
          .slice(top, top + fit)
          .map(one => one.slice(left))
          .join('\n')}
        language="sql"
        startLine={top + 1}
        wrap="truncate-end"
      />
    ) : (
      lines.slice(top, top + fit)
    )
    const contentCols = section?.code ? sectionCols : Math.max(section?.cols ?? 0, sectionCols)

    // Back, after a jump: to the object it left, named, at the header's right.
    const behind = (view.trail ?? [])[(view.trail ?? []).length - 1]
    const backButton = behind && (
      <Box flexShrink={0}>
        <Button key="back" plain dimColor hotkey={keyOf('b')} onPress={() => void act.back()}>
          {`← ${behind.name}`}
        </Button>
      </Box>
    )

    return (
      <Box
        key="detail"
        flexDirection="column"
        gap={1}
        width={isWide ? detailCols : undefined}
        {...rowsOf(detailRows)}
        marginTop={isFlow && isWide ? clamp(detailTop, 0, rows.length) : undefined}
        flexGrow={1}
        overflow="hidden"
        {...panel}
      >
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} flexShrink={0} overflow="hidden">
          <Box flexDirection="row" gap={1} alignItems="center" flexShrink={1} overflow="hidden">
            {tile(KIND_ICON[ref.kind], 32)}
            <Box flexDirection="column" flexShrink={1} overflow="hidden">
              <Text size="heading" weight="semibold" wrap="truncate-end">
                {ref.name}
              </Text>
              <Text dimColor size="footnote" wrap="truncate-end">
                {facts.join(' · ')}
              </Text>
            </Box>
          </Box>
          {backButton}
        </Box>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} flexShrink={0} overflow="hidden">
          {track(
            tabs.map(one => ({ id: one.id, label: one.label, key: `tab-${one.id}`, hotkey: one.hotkey })),
            view.tab,
            id => void act.setTab(id),
          )}
          <Box flexShrink={1} overflow="hidden">
            <Text dimColor size="footnote" wrap="truncate-end">
              {note}
            </Text>
          </Box>
        </Box>
        {section?.toolbar}
        {section && (
          <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" {...(section.code && isGraphic ? {} : well)}>
            {isFlow && hbar(left, leftSpan, sectionCols, moveAcross)}
            <Box flexDirection="row" gap={1} flexGrow={1} minHeight={0} overflow="hidden">
              <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
                <Box flexDirection="column" width={contentCols} marginLeft={section.code ? 0 : -left} flexShrink={0}>
                  {content}
                </Box>
              </Box>
              {vbar('detail', top, detailSpan, fit, moveDown)}
            </Box>
            {!isFlow && hbar(left, leftSpan, sectionCols, moveAcross)}
          </Box>
        )}
      </Box>
    )
  }

  // Wide with nothing open: the right panel says what goes there.
  const emptyPanel = (
    <Box flexDirection="column" width={detailCols} {...rowsOf(detailRows)} flexGrow={1} justifyContent="center" alignItems="center" {...panel}>
      <Text dimColor>Pick a table, view or sequence to see its columns, rows and DDL.</Text>
    </Box>
  )

  const detail = view.selected ? detailPanel(view.selected) : isWide ? emptyPanel : false
  const rest = treeTail.length > 0 && (
    <Box flexDirection="column" width={treeCols} flexShrink={0} overflow="hidden" {...panel}>
      {treeTail.map(drawRow)}
    </Box>
  )
  const body = (
    <Box flexDirection={isWide ? 'row' : 'column'} gap={1} alignItems={isFlow && isWide ? 'flex-start' : undefined} {...rowsOf(bodyRows)} overflow="hidden">
      {treePanel}
      {detail}
      {rest}
    </Box>
  )

  const element = (
    <Box flexDirection="column" gap={1}>
      {notice}
      {view.sources.length > 0 && body}
    </Box>
  )

  // The bar across sits on the detail panel's last inner row, inside the well's frame.
  const layout: PaneLayout = {
    isWide,
    isFlow,
    split: isWide ? treeCols : treeRows,
    across: (isWide ? 0 : treeRows + 1) + detailRows - (isGraphic ? 5 : 3),
    tree,
    detail: detailSpan,
    left: leftSpan,
    objectRows,
    for: detailFor,
  }

  return { element, layout }
}

/**
 * Where a wheel or a scroll key moves the pane: the part under the pointer,
 * across when it is over the object's lower bar or the object only moves
 * across; with no pointer, the open object, else the tree.
 */
export function scrolled(view: DbView, layout: PaneLayout, by: number, pointer?: { column: number; row: number }): DbScroll {
  const now = scrollOf(view, layout.for)
  const isOverTree = pointer ? (layout.isWide ? pointer.column < layout.split : pointer.row < layout.split) : layout.for === ''
  const part: 'tree' | 'detail' | 'left' = isOverTree
    ? 'tree'
    : layout.left.max > 0 && (layout.detail.max === 0 || (pointer !== undefined && pointer.row >= layout.across))
      ? 'left'
      : 'detail'
  const step = part === 'left' ? by * 4 : pointer ? by * 3 : by

  return { ...now, [part]: clamp(now[part] + step, 0, layout[part].max), for: layout.for }
}

/**
 * Whether the open object, standing at body row `at`, moves to the window's
 * top row `top` once the wheel rests. Always when there is room above it.
 * Otherwise when the wheel was over the tree, or, where the surface did not
 * say where the pointer was, once less than half the window still shows it:
 * a wheel over the object reads it down, and that is left be.
 */
export function shouldLift(at: number, top: number, bodyRows: number, objectRows: number, over?: 'tree' | 'object'): boolean {
  if (at === top) return false
  if (at > top) return true
  if (over !== undefined) return over === 'tree'

  return at + objectRows - top < bodyRows / 2
}

/** The object and tab open, which the detail's offsets belong to; empty with none. */
export function detailForOf(view: DbView): string {
  return view.selected ? `${relationKey(view.selected.source, view.selected.schema, view.selected.name)}:${view.tab}` : ''
}

/** The view's offsets, the detail's set back to the top left when another object or tab is open. */
function scrollOf(view: DbView, detailFor: string): DbScroll {
  const now = view.scroll ?? EMPTY_SCROLL

  return now.for === detailFor ? now : { ...now, detail: 0, left: 0, for: detailFor }
}

/** The source the picker names: the one unfolded, else the open object's, else the first. */
function shownSource(view: DbView): DbSource | undefined {
  const open = view.sources.find(one => view.expanded.includes(sourceId(one.id)))

  return open ?? view.sources.find(one => one.id === view.selected?.source) ?? view.sources[0]
}

/** `16.4 (Debian 16.4-1)` → `16`. */
function major(version: string): string {
  return version.split(/[ .]/)[0] ?? version
}

function cellText(cell: string | null): string {
  if (cell === null) return 'NULL'

  return cell.replace(/\r?\n/g, '↵').replace(/\t/g, ' ')
}

function clamp(n: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, n))
}
