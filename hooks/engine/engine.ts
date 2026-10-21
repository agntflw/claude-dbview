import type {
  DbCatalog,
  DbColumn,
  DbPreview,
  EngineRequest,
  EngineResult,
} from '../../types'
import { resolveConnection } from './connection'
import type { Host } from './host'
import { ident, runJson } from './psql'

// The server side: answers the pane's requests from the catalog. Every
// answer is one JSON document built inside Postgres.

const CATALOG_SQL = `
select json_build_object(
  'database', current_database(),
  'user', current_user,
  'version', current_setting('server_version'),
  'schemas', coalesce((
    select json_agg(s order by s.name)
    from (
      select n.nspname as name,
        coalesce((
          select json_agg(json_build_object(
            'name', c.relname,
            'kind', case c.relkind
              when 'r' then 'table' when 'p' then 'partitioned' when 'v' then 'view'
              when 'm' then 'matview' when 'f' then 'foreign' else 'sequence' end,
            'rows', case when c.reltuples < 0 or c.relkind = 'S' then null else c.reltuples::bigint end
          ) order by c.relname)
          from pg_class c
          where c.relnamespace = n.oid
            and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
            and not c.relispartition
        ), '[]'::json) as relations,
        coalesce((
          select json_agg(json_build_object(
            'name', p.proname,
            'args', pg_get_function_identity_arguments(p.oid),
            'returns', coalesce(pg_get_function_result(p.oid), ''),
            'kind', case p.prokind
              when 'p' then 'procedure' when 'a' then 'aggregate' when 'w' then 'window' else 'function' end
          ) order by p.proname, p.oid)
          from pg_proc p
          where p.pronamespace = n.oid
            and not exists (
              select 1 from pg_depend d
              where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
            )
        ), '[]'::json) as routines
      from pg_namespace n
      where n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'
    ) s
  ), '[]'::json)
);
`

const COLUMNS_SQL = `
select coalesce(json_agg(json_build_object(
  'name', a.attname,
  'type', format_type(a.atttypid, a.atttypmod),
  'notNull', a.attnotnull,
  'default', pg_get_expr(d.adbin, d.adrelid),
  'isPrimaryKey', coalesce(a.attnum = any(pk.conkey), false),
  'references', fk.target
) order by a.attnum), '[]'::json)
from pg_attribute a
left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
left join pg_constraint pk on pk.conrelid = a.attrelid and pk.contype = 'p'
left join lateral (
  select format('%s.%s', r.relname, ra.attname) as target
  from pg_constraint f
  join pg_class r on r.oid = f.confrelid
  join pg_attribute ra on ra.attrelid = f.confrelid
    and ra.attnum = f.confkey[array_position(f.conkey, a.attnum)]
  where f.conrelid = a.attrelid and f.contype = 'f' and a.attnum = any(f.conkey)
  limit 1
) fk on true
where a.attrelid = format('%I.%I', :'schema', :'name')::regclass
  and a.attnum > 0 and not a.attisdropped;
`

const DDL_SQL = `
select to_json(
  case
    when c.relkind in ('v', 'm') then format(
      E'create %s %I.%I as\\n%s',
      case c.relkind when 'v' then 'view' else 'materialized view' end,
      n.nspname, c.relname, pg_get_viewdef(c.oid, true))
    when c.relkind = 'S' then (
      select format(
        E'create sequence %I.%I\\n  as %s\\n  increment by %s\\n  minvalue %s\\n  maxvalue %s\\n  start with %s\\n  cache %s%s;',
        n.nspname, c.relname, format_type(s.seqtypid, null), s.seqincrement, s.seqmin, s.seqmax,
        s.seqstart, s.seqcache, case when s.seqcycle then E'\\n  cycle' else '' end)
      from pg_sequence s where s.seqrelid = c.oid)
    else format(E'create table %I.%I (\\n%s\\n);', n.nspname, c.relname, (
      select string_agg(x.line, E',\\n' order by x.ord)
      from (
        select a.attnum as ord, format('  %I %s%s%s',
          a.attname, format_type(a.atttypid, a.atttypmod),
          coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), ''),
          case when a.attnotnull then ' not null' else '' end) as line
        from pg_attribute a
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        union all
        select 100000 + row_number() over (order by k.contype desc, k.conname),
          format('  constraint %I %s', k.conname, pg_get_constraintdef(k.oid))
        from pg_constraint k where k.conrelid = c.oid
      ) x))
  end
  || coalesce(E'\\n\\n' || (
    select string_agg(pg_get_indexdef(i.indexrelid) || ';', E'\\n' order by i.indexrelid)
    from pg_index i
    where i.indrelid = c.oid
      and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)
  ), '')
)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.oid = format('%I.%I', :'schema', :'name')::regclass;
`

const PREVIEW_CELL_CHARS = 200

function previewSql(schema: string, name: string, columns: string[], limit: number): string {
  const cells = columns.map(column => `left(t.${ident(column)}::text, ${PREVIEW_CELL_CHARS})`)
  const row = cells.length > 0 ? `array[${cells.join(', ')}]` : `array[]::text[]`

  return `
select coalesce(json_agg(q.r), '[]'::json)
from (select ${row} as r from ${ident(schema)}.${ident(name)} t limit ${Math.max(1, Math.floor(limit))}) q;
`
}

export type Engine = {
  request: <R extends EngineRequest>(request: R) => Promise<EngineResult<R['op']>>
  label: () => Promise<string>
}

export function createEngine(host: Host, psqlPath: string): Engine {
  async function request<R extends EngineRequest>(req: R): Promise<EngineResult<R['op']>> {
    const connection = await resolveConnection(host)

    if (req.op === 'catalog') {
      const ran = await runJson<Omit<DbCatalog, 'host'>>(host, connection, psqlPath, CATALOG_SQL)
      if (!ran.ok) return ran

      return { ok: true, value: { ...ran.value, host: connection.label } } as EngineResult<R['op']>
    }

    if (req.op === 'columns') {
      const ran = await runJson<DbColumn[]>(host, connection, psqlPath, COLUMNS_SQL, {
        schema: req.schema,
        name: req.name,
      })
      if (!ran.ok) return ran

      return { ok: true, value: ran.value } as EngineResult<R['op']>
    }

    if (req.op === 'ddl') {
      const ran = await runJson<string>(host, connection, psqlPath, DDL_SQL, {
        schema: req.schema,
        name: req.name,
      })
      if (!ran.ok) return ran

      return { ok: true, value: ran.value } as EngineResult<R['op']>
    }

    const sql = previewSql(req.schema, req.name, req.columns, req.limit)
    const ran = await runJson<(string | null)[][]>(host, connection, psqlPath, sql)
    if (!ran.ok) return ran
    const preview: DbPreview = { columns: req.columns, rows: ran.value, limit: req.limit, ms: ran.ms }

    return { ok: true, value: preview } as EngineResult<R['op']>
  }

  return {
    request,
    label: async () => (await resolveConnection(host)).label,
  }
}
