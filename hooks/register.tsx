import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { createActions } from './client/actions'
import { drawPane } from './client/pane'
import { EMPTY_VIEW } from './client/state'
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
const USAGE = 'Use /db, /db connect postgres://user:password@host:5432/database, /db refresh or /db disconnect.'

export const register: Register = (on, options) => {
  const psqlPath = typeof options.psql_path === 'string' && options.psql_path ? options.psql_path : 'psql'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'db',
      description: 'Open the database view (PostgreSQL)',
      argumentHint: '[connect <url> | refresh | disconnect]',
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
      const parsed = parseUrl(rest.join(' '))
      if ('error' in parsed) return { text: parsed.error }
      await saveUrl(host, rest.join(' '))
      await act.reset()
      await $.ui.open({ id: PANE, title: TITLE })
      await act.loadCatalog()
      const after = (await read($, view)).status

      return {
        text:
          after.phase === 'error'
            ? `Could not connect to ${parsed.label}: ${after.error}`
            : `Connected to ${parsed.label}. The database view is open.`,
      }
    }

    if (verb === 'disconnect') {
      await forgetUrl(host)
      await act.reset()

      return { text: 'Forgot the saved connection. /db connect <url> sets a new one.' }
    }

    if (verb === 'refresh') {
      await act.loadCatalog()

      return { text: 'Database view refreshed.' }
    }

    if (verb !== '') return { text: USAGE }

    await $.ui.open({ id: PANE, title: TITLE })
    if ((await read($, view)).catalog === null) await act.loadCatalog()
    const after = (await read($, view)).status

    return { text: after.phase === 'error' ? `Database view opened. ${after.error}` : 'Database view opened.' }
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

    return drawPane({
      els,
      Input: e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input,
      Svg: e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg,
      width: e.props.bodyColumns,
      view: await read($, view),
      act,
    })
  })
}
