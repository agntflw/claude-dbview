import type { DbCatalog, DbPreview, DbRelationDetail, EngineRequest, EngineResult } from '../../types'
import { listSources, resolveTarget } from './connection'
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

const RELATION_SQL = `
with rel as (select format('%I.%I', :'schema', :'name')::regclass as oid)
select json_build_object(
  'columns', coalesce((
    select json_agg(json_build_object(
      'name', a.attname,
      'type', format_type(a.atttypid, a.atttypmod),
      'notNull', a.attnotnull,
      'default', pg_get_expr(d.adbin, d.adrelid),
      'isPrimaryKey', coalesce(a.attnum = any(pk.conkey), false),
      'references', fk.target,
      'target', case when fk.target is not null then json_build_object('schema', fk.schema, 'name', fk.name) end
    ) order by a.attnum)
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    left join pg_constraint pk on pk.conrelid = a.attrelid and pk.contype = 'p'
    left join lateral (
      select format('%s.%s(%s)', rn.nspname, r.relname, ra.attname) as target, rn.nspname as schema, r.relname as name
      from pg_constraint f
      join pg_class r on r.oid = f.confrelid
      join pg_namespace rn on rn.oid = r.relnamespace
      join pg_attribute ra on ra.attrelid = f.confrelid
        and ra.attnum = f.confkey[array_position(f.conkey, a.attnum)]
      where f.conrelid = a.attrelid and f.contype = 'f' and a.attnum = any(f.conkey)
      limit 1
    ) fk on true
    where a.attrelid = (select oid from rel) and a.attnum > 0 and not a.attisdropped
  ), '[]'::json),
  'constraints', coalesce((
    select json_agg(json_build_object(
      'name', k.conname,
      'kind', case k.contype
        when 'p' then 'primary' when 'u' then 'unique' when 'f' then 'foreign' when 'c' then 'check'
        when 'x' then 'exclusion' when 't' then 'trigger' else 'notnull' end,
      'definition', pg_get_constraintdef(k.oid, true),
      'target', case when k.contype = 'f' then (
        select json_build_object('schema', rn.nspname, 'name', r.relname)
        from pg_class r join pg_namespace rn on rn.oid = r.relnamespace
        where r.oid = k.confrelid
      ) end
    ) order by position(k.contype::text in 'pufcxtn'), k.conname)
    from pg_constraint k
    where k.conrelid = (select oid from rel) and k.contype <> 'n'
  ), '[]'::json),
  'referencedBy', coalesce((
    select json_agg(json_build_object(
      'constraint', k.conname,
      'schema', sn.nspname,
      'name', s.relname,
      'columns', (
        select json_agg(sa.attname order by u.ord)
        from unnest(k.conkey) with ordinality u(attnum, ord)
        join pg_attribute sa on sa.attrelid = k.conrelid and sa.attnum = u.attnum
      )
    ) order by sn.nspname, s.relname, k.conname)
    from pg_constraint k
    join pg_class s on s.oid = k.conrelid
    join pg_namespace sn on sn.oid = s.relnamespace
    where k.confrelid = (select oid from rel) and k.contype = 'f'
  ), '[]'::json),
  'indexes', coalesce((
    select json_agg(json_build_object(
      'name', ic.relname,
      'definition', case when i.indisunique then 'UNIQUE ' else '' end
        || regexp_replace(pg_get_indexdef(i.indexrelid), '^.* USING ', '')
    ) order by not i.indisprimary, ic.relname)
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    where i.indrelid = (select oid from rel)
  ), '[]'::json)
);
`

// In the order a migration would run it: the table's own sequences, the
// table with its defaults and named constraints, its other indexes, then
// the sequences' OWNED BY.
const DDL_SQL = `
with target as (
  select c.oid, c.relkind, c.relname, n.nspname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.oid = format('%I.%I', :'schema', :'name')::regclass
),
seqs as (
  select s.seqrelid as oid, dep.refobjid as owner,
    format(
      E'CREATE SEQUENCE %I.%I\\n  AS %s\\n  INCREMENT BY %s\\n  MINVALUE %s\\n  MAXVALUE %s\\n  START WITH %s\\n  CACHE %s%s;',
      sn.nspname, sc.relname, format_type(s.seqtypid, null), s.seqincrement, s.seqmin, s.seqmax,
      s.seqstart, s.seqcache, case when s.seqcycle then E'\\n  CYCLE' else '' end) as ddl,
    case when dep.refobjid is not null then
      format('ALTER SEQUENCE %I.%I OWNED BY %I.%I.%I;', sn.nspname, sc.relname, tn.nspname, tc.relname, ta.attname)
    end as owned
  from pg_sequence s
  join pg_class sc on sc.oid = s.seqrelid
  join pg_namespace sn on sn.oid = sc.relnamespace
  left join pg_depend dep on dep.classid = 'pg_class'::regclass and dep.objid = s.seqrelid
    and dep.refclassid = 'pg_class'::regclass and dep.deptype = 'a'
  left join pg_class tc on tc.oid = dep.refobjid
  left join pg_namespace tn on tn.oid = tc.relnamespace
  left join pg_attribute ta on ta.attrelid = dep.refobjid and ta.attnum = dep.refobjsubid
  where s.seqrelid = (select oid from target) or dep.refobjid = (select oid from target)
)
select to_json(
  case
    when t.relkind in ('v', 'm') then format(
      E'CREATE %s %I.%I AS\\n%s',
      case t.relkind when 'v' then 'VIEW' else 'MATERIALIZED VIEW' end,
      t.nspname, t.relname, pg_get_viewdef(t.oid, true))
    when t.relkind = 'S' then (
      select s.ddl || coalesce(E'\\n\\n' || s.owned, '') from seqs s where s.oid = t.oid)
    else coalesce((
        select string_agg(s.ddl, E'\\n\\n' order by s.oid) from seqs s where s.owner = t.oid
      ) || E'\\n\\n', '')
      || format(E'CREATE TABLE %I.%I (\\n%s\\n);', t.nspname, t.relname, (
        select string_agg(x.line, E',\\n' order by x.ord)
        from (
          select a.attnum as ord, format('  %I %s%s%s%s',
            a.attname, format_type(a.atttypid, a.atttypmod),
            case a.attidentity
              when 'a' then ' GENERATED ALWAYS AS IDENTITY'
              when 'd' then ' GENERATED BY DEFAULT AS IDENTITY' else '' end,
            coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), ''),
            case when a.attnotnull then ' NOT NULL' else '' end) as line
          from pg_attribute a
          left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
          union all
          select 100000 + row_number() over (order by position(k.contype::text in 'pufcx'), k.conname),
            format('  CONSTRAINT %I %s', k.conname, pg_get_constraintdef(k.oid))
          from pg_constraint k where k.conrelid = t.oid and k.contype in ('p', 'u', 'f', 'c', 'x')
        ) x))
  end
  || coalesce(E'\\n\\n' || (
    select string_agg(pg_get_indexdef(i.indexrelid) || ';', E'\\n' order by i.indexrelid)
    from pg_index i
    where i.indrelid = t.oid
      and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)
  ), '')
  || case when t.relkind = 'S' then '' else coalesce(E'\\n\\n' || (
    select string_agg(s.owned, E'\\n' order by s.oid) from seqs s where s.owner = t.oid
  ), '') end
)
from target t;
`

const PREVIEW_CELL_CHARS = 200

/** The SQL that reads the rows, and the same read as the pane shows it. */
function previewSql(schema: string, name: string, columns: string[], order: string[], limit: number) {
  const cells = columns.map(column => `left(t.${ident(column)}::text, ${PREVIEW_CELL_CHARS})`)
  const row = cells.length > 0 ? `array[${cells.join(', ')}]` : `array[]::text[]`
  const count = Math.max(1, Math.floor(limit))
  const orderBy = (quote: (name: string) => string, prefix: string) =>
    order.length > 0 ? ` ORDER BY ${order.map(one => prefix + quote(one)).join(', ')}` : ''

  return {
    sql: `
select coalesce(json_agg(q.r), '[]'::json)
from (select ${row} as r from ${ident(schema)}.${ident(name)} t${orderBy(ident, 't.')} limit ${count}) q;
`,
    query: `SELECT * FROM ${shown(schema)}.${shown(name)}${orderBy(shown, '')} LIMIT ${count};`,
  }
}

/** An identifier as a person writes it: quoted only when it must be. */
function shown(name: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name) ? name : ident(name)
}

export type Engine = {
  request: <R extends EngineRequest>(request: R) => Promise<EngineResult<R['op']>>
}

export function createEngine(host: Host, psqlPath: string): Engine {
  async function request<R extends EngineRequest>(req: R): Promise<EngineResult<R['op']>> {
    type Answer = EngineResult<R['op']>

    if (req.op === 'sources') return { ok: true, value: await listSources(host) } as Answer

    const target = await resolveTarget(host, req.source)
    if ('error' in target) return { ok: false, error: target.error }

    if (req.op === 'catalog') return (await runJson<DbCatalog>(host, target, psqlPath, CATALOG_SQL)) as Answer

    if (req.op === 'relation') {
      const vars = { schema: req.schema, name: req.name }

      return (await runJson<DbRelationDetail>(host, target, psqlPath, RELATION_SQL, vars)) as Answer
    }

    if (req.op === 'ddl') {
      const vars = { schema: req.schema, name: req.name }

      return (await runJson<string>(host, target, psqlPath, DDL_SQL, vars)) as Answer
    }

    const { sql, query } = previewSql(req.schema, req.name, req.columns, req.order, req.limit)
    const ran = await runJson<(string | null)[][]>(host, target, psqlPath, sql)
    if (!ran.ok) return ran
    const preview: DbPreview = { query, columns: req.columns, rows: ran.value, limit: req.limit, ms: ran.ms }

    return { ok: true, value: preview } as Answer
  }

  return { request }
}
