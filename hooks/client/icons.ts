// The pane's icon set, from the design direction: 16-unit line icons, drawn
// as small SVG images where the surface has them and as one glyph on the
// terminal. Objects sit on a tinted tile, as pinned items do in the sidebar.

export type IconName =
  | 'chevronRight'
  | 'chevronDown'
  | 'schema'
  | 'folder'
  | 'table'
  | 'view'
  | 'matview'
  | 'function'
  | 'sequence'
  | 'column'
  | 'key'
  | 'link'
  | 'database'
  | 'search'
  | 'check'
  | 'notnull'
  | 'index'
  | 'copy'
  | 'refresh'

const PATHS: Record<IconName, string> = {
  chevronRight: 'M6 4l4 4-4 4',
  chevronDown: 'M4 6l4 4 4-4',
  schema: 'M8 2.5l5.5 2.75L8 8 2.5 5.25 8 2.5z M2.5 8.25L8 11l5.5-2.75 M2.5 11.25L8 14l5.5-2.75',
  folder: 'M2.5 4.5a1 1 0 0 1 1-1h2.8l1.5 1.5h5.2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9.5a1 1 0 0 1-1-1z',
  table: 'M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12z M2.5 6.5h11 M2.5 10h11 M6.5 6.5v7',
  view: 'M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z M10 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  matview: 'M5 2.5h7.5a1 1 0 0 1 1 1V11 M2.5 5.5a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1z M2.5 8.5h8.5',
  function: 'M11 2.5h-1.2A2 2 0 0 0 7.8 4.5v7a2 2 0 0 1-2 2H4.5 M5 7h5.5',
  sequence: 'M6.5 2.5l-1 11 M11 2.5l-1 11 M3 6h10.5 M2.5 10H13',
  column: 'M5.5 3.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1z',
  key: 'M7.5 10.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M6.8 8.7L12.5 3 M10.7 4.8l1.6 1.6 M9 6.5l1.3 1.3',
  link: 'M6.5 9.5l3-3 M7 4.5l1-1a2.83 2.83 0 0 1 4 4l-1 1 M9 11.5l-1 1a2.83 2.83 0 0 1-4-4l1-1',
  database:
    'M2.5 4c0-.97 2.46-1.75 5.5-1.75s5.5.78 5.5 1.75v8c0 .97-2.46 1.75-5.5 1.75S2.5 12.97 2.5 12z M13.5 4c0 .97-2.46 1.75-5.5 1.75S2.5 4.97 2.5 4 M13.5 8c0 .97-2.46 1.75-5.5 1.75S2.5 8.97 2.5 8',
  search: 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M14 14l-3.5-3.5',
  check: 'M3.5 8.5l3 3 6-7',
  notnull: 'M8 3v10 M3.7 5.5l8.6 5 M3.7 10.5l8.6-5',
  index: 'M3 3.5h10 M3 8h7 M3 12.5h4',
  copy: 'M5.5 5.5V4a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 13.5 4v5a1.5 1.5 0 0 1-1.5 1.5h-1.5 M2.5 7a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 10.5 7v5A1.5 1.5 0 0 1 9 13.5H4A1.5 1.5 0 0 1 2.5 12z',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9 M13.5 2.5v3h-3',
}

const GLYPHS: Record<IconName, string> = {
  chevronRight: '›',
  chevronDown: '⌄',
  schema: '≡',
  folder: '▪',
  table: '▦',
  view: '◎',
  matview: '◫',
  function: 'ƒ',
  sequence: '#',
  column: '·',
  key: '*',
  link: '→',
  database: '◇',
  search: '⌕',
  check: '✓',
  notnull: '*',
  index: '≣',
  copy: '⧉',
  refresh: '↻',
}

export const COLOR = {
  text: '#ecebe6',
  column: '#c9c7c0',
  muted: '#9c9a94',
  pill: '#30302e',
  border: '#3a3936',
  ground: '#1f1e1d',
  connected: '#6cc070',
  link: '#6aa6ee',
  /** The tree's and the open object's panels, a step darker than the pane. */
  panel: '#1a1918',
  /** The well a section scrolls in, darker again. */
  well: '#141413',
  /** A table's header strip. */
  strip: '#262624',
  /** Scrollbar track and thumb. */
  track: '#262523',
  thumb: '#5a5852',
}

/** Icon colour and tile colour per object kind. */
export const TINT: Partial<Record<IconName, { icon: string; tile: string }>> = {
  database: { icon: '#6cc070', tile: '#243526' },
  table: { icon: '#6cc070', tile: '#243526' },
  view: { icon: '#6aa6ee', tile: '#1f2e42' },
  matview: { icon: '#5cbfb5', tile: '#1d3431' },
  function: { icon: '#a08ff0', tile: '#2c2843' },
  sequence: { icon: '#e0a94e', tile: '#3a2f1e' },
  key: { icon: '#e0a94e', tile: '#3a2f1e' },
  link: { icon: '#6aa6ee', tile: '#1f2e42' },
}

const STROKE = 'fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"'

/** A bare 16 px line icon. */
export function lineSvg(name: IconName, color: string = COLOR.muted): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
    `<path d="${PATHS[name]}" stroke="${color}" ${STROKE}/></svg>`
  )
}

/** A 14 px icon on a tinted rounded tile, `size` px square. */
export function tileSvg(name: IconName, size: number): string {
  const tint = TINT[name] ?? { icon: COLOR.muted, tile: COLOR.pill }
  const scale = (size * 0.7) / 16
  const offset = (size - 16 * scale) / 2

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${Math.round(size * 0.3)}" fill="${tint.tile}"/>` +
    `<g transform="translate(${offset} ${offset}) scale(${scale})">` +
    `<path d="${PATHS[name]}" stroke="${tint.icon}" ${STROKE}/></g></svg>`
  )
}

/** Nothing, 16 px wide: keeps a leaf's label in line with its siblings'. */
export const SPACER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"></svg>'

export function glyphOf(name: IconName): string {
  return GLYPHS[name]
}
