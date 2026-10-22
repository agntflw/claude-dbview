// The pane's colours, as three palettes of one shape. The surfaces do not
// say whether the app around them is light or dark, so `system` paints
// nothing of its own that only reads on one of them: text in the surface's
// own colour, which follows the app, and fills and lines as faint layers of
// grey or black that sit on either. `light` and `dark` paint every colour
// themselves, for whoever wants one look whatever the app does.
// The terminal keeps the terminal's colours: it draws no panels, and its
// text stays in the terminal's own.

import type { IconName } from './icons'

export type ThemeMode = 'system' | 'light' | 'dark'

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark']

export type Palette = {
  /** Body text. Absent: the surface's own, which follows the app's theme. */
  text?: string
  /** A column's name in the tree, a step softer than the text. */
  column?: string
  /** Line icons, chevrons, scroll steps. */
  muted: string
  /** A table's header strip. */
  strip: string
  /** The pills' and panels' edge. */
  border: string
  /** What the switcher and the tracks sit on. Absent: nothing, the pane shows through. */
  ground?: string
  /** An unchosen pill's edge: the colour of what it sits on, so it does not show. */
  edge: string
  /** The tree's and the open object's panels, a step darker than the pane. */
  panel: string
  /** The well a section scrolls in, darker again. */
  well: string
  /** A chosen pill or tree row. */
  pill: string
  /** A row or a segment under the pointer. */
  hover: string
  /** Scrollbar track and thumb. */
  track: string
  thumb: string
  connected: string
  /** A foreign key's reference. */
  link: string
  /** Icon colour and tile colour per object kind. */
  tint: Partial<Record<IconName, { icon: string; tile: string }>>
  /** Where set, a tile is its icon's colour at this opacity, so it sits on either theme. */
  tileOpacity?: number
}

const GREEN = '#6cc070'
const BLUE = '#6aa6ee'
const TEAL = '#5cbfb5'
const VIOLET = '#a08ff0'
const AMBER = '#e0a94e'

/** The pane as it was drawn before it had a theme: dark, warm greys. */
export const DARK: Palette = {
  text: '#ecebe6',
  column: '#c9c7c0',
  muted: '#9c9a94',
  strip: '#262624',
  border: '#3a3936',
  ground: '#1f1e1d',
  edge: '#1f1e1d',
  panel: '#1a1918',
  well: '#141413',
  pill: '#30302e',
  hover: '#262523',
  track: '#262523',
  thumb: '#5a5852',
  connected: GREEN,
  link: BLUE,
  tint: {
    database: { icon: GREEN, tile: '#243526' },
    table: { icon: GREEN, tile: '#243526' },
    view: { icon: BLUE, tile: '#1f2e42' },
    matview: { icon: TEAL, tile: '#1d3431' },
    function: { icon: VIOLET, tile: '#2c2843' },
    sequence: { icon: AMBER, tile: '#3a2f1e' },
    key: { icon: AMBER, tile: '#3a2f1e' },
    link: { icon: BLUE, tile: '#1f2e42' },
  },
}

/** The same pane on paper: warm off-whites, the accents a shade deeper so they read on them. */
export const LIGHT: Palette = {
  text: '#1f1e1d',
  column: '#3d3c38',
  muted: '#73716b',
  strip: '#ebe9e2',
  border: '#dedcd3',
  ground: '#faf9f5',
  edge: '#faf9f5',
  panel: '#f5f4ef',
  well: '#efeee8',
  pill: '#e5e3da',
  hover: '#ecebe4',
  track: '#e5e3da',
  thumb: '#b3b1a9',
  connected: '#3f9a4a',
  link: '#2e6fc4',
  tint: {
    database: { icon: '#3f9a4a', tile: '#e0efe1' },
    table: { icon: '#3f9a4a', tile: '#e0efe1' },
    view: { icon: '#2e6fc4', tile: '#e0eaf7' },
    matview: { icon: '#2a9488', tile: '#dcefec' },
    function: { icon: '#7a62d8', tile: '#ebe6fa' },
    sequence: { icon: '#b07a1e', tile: '#f4e9d5' },
    key: { icon: '#b07a1e', tile: '#f4e9d5' },
    link: { icon: '#2e6fc4', tile: '#e0eaf7' },
  },
}

// Mid tones that keep their contrast on white and on near black alike.
const S_GREEN = '#4aa352'
const S_BLUE = '#4a8ad8'
const S_TEAL = '#2f9e93'
const S_VIOLET = '#8b78e6'
const S_AMBER = '#b8862b'

/** Follows the app: no text colour of its own, and layers in place of fills. */
export const SYSTEM: Palette = {
  muted: '#8e8c86',
  strip: 'rgba(128, 128, 128, 0.12)',
  border: 'rgba(128, 128, 128, 0.26)',
  edge: 'transparent',
  panel: 'rgba(0, 0, 0, 0.03)',
  well: 'rgba(0, 0, 0, 0.035)',
  pill: 'rgba(128, 128, 128, 0.2)',
  hover: 'rgba(128, 128, 128, 0.12)',
  track: 'rgba(128, 128, 128, 0.25)',
  thumb: 'rgba(128, 128, 128, 0.7)',
  connected: S_GREEN,
  link: S_BLUE,
  tint: {
    database: { icon: S_GREEN, tile: S_GREEN },
    table: { icon: S_GREEN, tile: S_GREEN },
    view: { icon: S_BLUE, tile: S_BLUE },
    matview: { icon: S_TEAL, tile: S_TEAL },
    function: { icon: S_VIOLET, tile: S_VIOLET },
    sequence: { icon: S_AMBER, tile: S_AMBER },
    key: { icon: S_AMBER, tile: S_AMBER },
    link: { icon: S_BLUE, tile: S_BLUE },
  },
  tileOpacity: 0.16,
}

/** What the terminal draws: the dark palette's accents, the terminal's own text. */
export const TERMINAL: Palette = { ...DARK, text: undefined, column: undefined }

export function paletteOf(mode: ThemeMode): Palette {
  return mode === 'light' ? LIGHT : mode === 'dark' ? DARK : SYSTEM
}

/** A stored or typed mode, else `system`. */
export function themeModeOf(value: unknown): ThemeMode {
  return THEME_MODES.includes(value as ThemeMode) ? (value as ThemeMode) : 'system'
}
