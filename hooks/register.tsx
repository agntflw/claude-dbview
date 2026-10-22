import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { createActions } from './client/actions'
import { detailForOf, drawPane, scrolled, shouldLift } from './client/pane'
import type { PaneLayout } from './client/pane'
import { EMPTY_VIEW } from './client/state'
import { THEME_MODES, themeModeOf } from './client/theme'
import type { ThemeMode } from './client/theme'
import { forgetUrl, parseUrl, saveUrl } from './engine/connection'
import { createEngine } from './engine/engine'
import type { Host } from './engine/host'

// dbview: a PostgreSQL database view in a pane.
// Server side, ./engine: runs in the CLI and reaches Postgres through psql.
// Client side, ./client: draws the pane from one view value on any surface.
// This module is the seam: it alone spells `$`, and hands each side plain
// functions built from it.

const PANE = 'dbview'
const TITLE = 'Database'
const view = atom({ plugin: 'dbview', key: 'view' } as const, EMPTY_VIEW)
/** What the pane last laid out, so a wheel over it moves the part under the pointer. */
let layout: PaneLayout | undefined
/** Where the body scrolls: the open object, and the body row it stands at. */
let opened: { for: string; top: number } | undefined
/** The latest wheel over the tree, so the object follows once it stops. */
let settling = 0
/** How long the wheel rests before the open object comes to the top of the window. */
const SETTLE_MS = 300
/** The palette the pane draws in, kept across sessions. */
const THEME_KEY = 'theme'
const USAGE =
  'Use /db, /db connect postgres://user:password@host:5432/database [name], /db forget <name>, /db refresh ' +
  'or /db theme system|light|dark. Running Postgres containers show up by themselves.'
const THEME_WORD: Record<ThemeMode, string> = {
  system: 'follows the app’s light or dark theme',
  light: 'stays light',
  dark: 'stays dark',
}

export const register: Register = (on, options) => {
  const psqlPath = typeof options.psql_path === 'string' && options.psql_path ? options.psql_path : 'psql'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'db',
      description: 'Open the database view (PostgreSQL)',
      argumentHint: '[connect <url> [name] | forget <name> | refresh | theme system|light|dark]',
    })

    return next(e)
  })

  on('command.run', { command: 'db' }, async ($, e) => {
    const host: Host = {
      run: (argv, init) => $.process.run(argv, init),
      now: () => $.clock.now(),
      store: {
        get: key => $.store.get(key),
        set: (key, value) => $.store.set(key, value),
        delete: key => $.store.delete(key),
      },
      env: async () => ({
        DATABASE_URL: await $.env.get('DATABASE_URL'),
        PGHOST: await $.env.get('PGHOST'),
        PGPORT: await $.env.get('PGPORT'),
        PGUSER: await $.env.get('PGUSER'),
        PGDATABASE: await $.env.get('PGDATABASE'),
        USER: await $.env.get('USER'),
      }),
    }
    const act = createActions(createEngine(host, psqlPath), {
      get: () => read($, view),
      set: change => update($, view, change),
    })

    const [verb = '', ...rest] = e.args.trim().split(/\s+/)

    if (verb === 'connect') {
      const [url = '', name] = rest
      const parsed = parseUrl(url)
      if ('error' in parsed) return { text: parsed.error }
      const saved = await saveUrl(host, url, name)
      await $.ui.open({ id: PANE, title: TITLE })
      await act.loadSources()
      await act.pickSource(`saved:${saved}`)
      const after = (await read($, view)).status[`saved:${saved}`]

      return {
        text:
          after?.phase === 'error'
            ? `Saved ${saved} (${parsed.label}), but it did not answer: ${after.error}`
            : `Connected to ${parsed.label} as ${saved}. The database view is open.`,
      }
    }

    if (verb === 'forget' || verb === 'disconnect') {
      const [name = ''] = rest
      if (!(await forgetUrl(host, name))) return { text: `No saved connection is named ${name || 'that'}. ${USAGE}` }
      await act.loadSources()

      return { text: `Forgot ${name}.` }
    }

    // The palette, for the graphical surfaces: the terminal keeps its own colours.
    if (verb === 'theme') {
      const [mode = ''] = rest
      if (!THEME_MODES.includes(mode as ThemeMode)) {
        const now = themeModeOf(await $.store.get(THEME_KEY))

        return { text: `The database view ${THEME_WORD[now]} (${now}). Use /db theme system, light or dark.` }
      }
      await $.store.set(THEME_KEY, mode)
      $.ui.invalidate('ui.render')

      return { text: `The database view now ${THEME_WORD[mode as ThemeMode]}.` }
    }

    if (verb === 'refresh') {
      await act.refresh()

      return { text: 'Database view refreshed.' }
    }

    if (verb !== '') return { text: USAGE }

    await $.ui.open({ id: PANE, title: TITLE })
    if ((await read($, view)).sources.length === 0) await act.loadSources()
    const after = await read($, view)
    if (after.sourcesStatus.phase === 'error') return { text: `Database view opened. ${after.sourcesStatus.error}` }
    const names = after.sources.map(one => one.label)

    return {
      text:
        names.length === 0
          ? `Database view opened. No database found yet. ${USAGE}`
          : `Database view opened on ${names.length === 1 ? names[0] : `${names.length} databases: ${names.join(', ')}`}.`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const host: Host = {
      run: (argv, init) => $.process.run(argv, init),
      now: () => $.clock.now(),
      store: {
        get: key => $.store.get(key),
        set: (key, value) => $.store.set(key, value),
        delete: key => $.store.delete(key),
      },
      env: async () => ({
        DATABASE_URL: await $.env.get('DATABASE_URL'),
        PGHOST: await $.env.get('PGHOST'),
        PGPORT: await $.env.get('PGPORT'),
        PGUSER: await $.env.get('PGUSER'),
        PGDATABASE: await $.env.get('PGDATABASE'),
        USER: await $.env.get('USER'),
      }),
    }
    const act = createActions(createEngine(host, psqlPath), {
      get: () => read($, view),
      set: change => update($, view, change),
    })

    const els = $.ui.resolve(e)
    const theme = themeModeOf(await $.store.get(THEME_KEY))
    const now = await read($, view)
    // Where the body scrolls, an object opens where the window is, so it is
    // in view beside the row that opened it however far the tree goes.
    if (opened?.for !== detailForOf(now)) opened = { for: detailForOf(now), top: e.props.scroll.offset }
    const drawn = drawPane({
      els,
      Input: e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input,
      Select: e.surface === 'mobile' ? undefined : $.ui.resolve(e).Select,
      Svg: e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg,
      copy: text => void $.ui.copy({ text, surface: e.surface }),
      width: e.props.bodyColumns,
      height: e.props.scroll.bodyRows,
      detailTop: opened.top,
      view: now,
      act,
      theme,
    })
    layout = drawn.layout

    return drawn.element
  })

  // On the terminal the pane scrolls its tree and its open object itself,
  // each in a window of its own, so the body never moves: the wheel moves the
  // part under it. A graphical surface has moved the body already: let it.
  // Wide, once the wheel rests, the open object comes to the top of the
  // window: it moves once, after the scroll, never during it.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const now = layout
    if (now?.isFlow && now.isWide && now.objectRows > 0) {
      const tick = ++settling
      const top = Math.min(Math.max(0, e.offset), Math.max(0, e.contentRows - e.bodyRows))
      const over = e.pointer === undefined ? undefined : e.pointer.column < now.split ? 'tree' : 'object'
      $.clock.after(SETTLE_MS, () => {
        if (tick !== settling || !opened) return
        if (shouldLift(opened.top, top, e.bodyRows, now.objectRows, over)) {
          opened = { ...opened, top }
          $.ui.invalidate('ui.render')
        }
      })
    }
    if (!now || now.isFlow) return next(e)
    await update($, view, value => ({ ...value, scroll: scrolled(value, now, e.by, e.pointer) }))

    return {}
  })
}
