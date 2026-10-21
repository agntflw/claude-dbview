# dbview

A PostgreSQL database view for Claude Code, in a pane beside the chat: every database and Postgres container as an IDE-style tree, with columns, constraints, rows and DDL. Read-only.

![dbview: the Rows, Columns and DDL tabs](docs/images/tour.gif)

<sub>Design mockups of the pane on the desktop app. The pane draws the same layout with the surface's own elements; on the terminal it uses glyphs and no borders.</sub>

## Quick start

1. Install, once, for every project (user scope):

   ```
   claude plugin install dbview --marketplace agntflw/claude-dbview --config psql_path=psql
   ```

2. Start a new Claude Code session (one already open does not see the plugin until you run `/reload-plugins` in it), then type `/db`. The pane opens on the databases it finds: your `DATABASE_URL` or `PG*` variables, and every running Postgres container.
3. To add another one: `/db connect postgres://user:password@host:5432/database [name]`.
4. Press a database, then a table. Switch between Columns, Rows (pick 50, 100, 500 or 1000) and DDL.

### Or let Claude install it

Paste this into Claude Code, in any folder:

```
Install the dbview plugin for Claude Code globally for me (user scope), from github.com/agntflw/claude-dbview.
1. Run: claude plugin install dbview --marketplace agntflw/claude-dbview --scope user --config psql_path=psql
   If this Claude Code is too old for --marketplace, run instead:
   claude plugin marketplace add agntflw/claude-dbview, then claude plugin install dbview@claude-dbview --scope user
2. Run: claude plugin list, and check dbview is installed and enabled.
3. Check what it needs: psql --version, and docker --version if I use Postgres in Docker.
   Tell me what is missing and how to install it on this machine, but do not install it.
4. Tell me to start a new Claude Code session and type /db.
```

### Add MySQL beside Postgres

dbview reads PostgreSQL only. To have Claude add MySQL (8.4 LTS, or pinned to 8.4.5) to your copy, paste this into Claude Code, in any folder:

```
Add MySQL support to my dbview plugin (github.com/agntflw/claude-dbview), beside PostgreSQL,
without changing how Postgres works.

Find the code first: use the claude-dbview folder that `claude plugin list` shows dbview is read from,
else one already on this machine, else clone the repository to ~/.claude/plugins-src/claude-dbview.
Work in that folder.

Set up a test database first:
- Run MySQL 8.4 in Docker: docker run -d --name mysql84 -e MYSQL_ROOT_PASSWORD=dev
  -e MYSQL_DATABASE=shop -p 33306:3306 mysql:8.4  (the latest 8.4 LTS; write mysql:8.4.5 here to pin it).
- Wait until it accepts connections, then load a MySQL version of dev/seed.sql
  (schemas become databases; serial becomes AUTO_INCREMENT; keep the same tables, keys and rows).

Then extend the mod, following its layout (types first, then engine, then pane):
1. types/index.d.ts: add an engine field ('postgres' | 'mysql') to DbSource, and keep every request shape.
2. hooks/engine/: add a MySQL driver next to psql.ts. Run the mysql client inside the container
   (docker exec -i <container> mysql -N -B ...) or on the host for mysql:// URLs.
   Pass the password in MYSQL_PWD, never on the command line.
   Every session is read-only: SET SESSION TRANSACTION READ ONLY and max_execution_time=10000.
   Build each answer as one JSON document with JSON_OBJECT and JSON_ARRAYAGG
   from information_schema (catalog, columns, constraints, indexes).
   Use SHOW CREATE TABLE / VIEW for the DDL.
3. hooks/engine/docker.ts: also discover mysql and mariadb containers
   (user root with MYSQL_ROOT_PASSWORD, or MYSQL_USER and MYSQL_PASSWORD; database from MYSQL_DATABASE).
4. /db connect: accept mysql:// URLs as well as postgres://.
5. Pane: show the engine and version on each database row and in the switcher
   (MySQL 8.4 · docker). MySQL has no schemas inside a database, so skip the schema level for it.
   Sequences and materialized views do not exist there.

Prove it:
- Extend dev/engine-e2e.ts with MySQL checks against mysql84
  (catalog, columns, a foreign key, an index, 50 rows in key order, DDL),
  and re-record tests/fixtures.ts.
- Add pane tests for a MySQL source. Run claude plugin validate . and claude plugin test .
- Bump the version in .claude-plugin/plugin.json, then reinstall from that folder:
  claude plugin install dbview --marketplace <folder> --scope user
- Tell me to start a new session and type /db, where the Postgres and MySQL databases sit side by side.
```

## What it shows

Each database is a root of the tree, with its schemas as packages inside, then Tables, Views, Materialized views, Sequences and Functions folders, then the objects and their columns. Open a table or view to see:

- **Columns**: name, type, nullable, primary key or `→ schema.table(column)` reference, defaults, then the constraints (keys, foreign keys, checks, not null) and indexes.
- **Rows**: the first 50, 100, 500 or 1000 rows in key order, with the query shown.
- **DDL**: the table as a migration would create it (its sequences, the table with defaults and named constraints, indexes, `OWNED BY`), numbered, with Copy.

Every Postgres container Docker is running shows up by itself, so the databases a migration test leaves behind (say `mig_before` and `mig_after`) sit side by side in the tree to compare.

Everything is read-only: each request runs in a read-only session with a 10 second statement timeout.

## Install, in detail

At the prompt of a terminal session:

```
/plugin install dbview --marketplace agntflw/claude-dbview
```

Answer `y` to add the marketplace, then pick a scope (user is the first). From a shell:

```
claude plugin install dbview --marketplace agntflw/claude-dbview
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `agntflw/claude-dbview`, then Add plugin.

On a Claude Code older than v2.1.292, add the marketplace first, then install from it:

```
claude plugin marketplace add agntflw/claude-dbview
claude plugin install dbview@claude-dbview
```

To update: `claude plugin update dbview@claude-dbview`, or turn on auto-update for `claude-dbview` in `/plugin` › Marketplaces.

On a claude.ai Team or Enterprise plan, an Owner can also add dbview for everyone in **Organization settings › Plugins & skills**; it then reaches each member's Claude Code as `dbview@synced`.

## If /db does not show up

1. Start a new session, or run `/reload-plugins` in the open one. A plugin installed from a shell loads in sessions started after the install.
2. Check `claude --version`: mods (plugins with a hooks module, like this one) need a recent Claude Code. Run `claude update` if it is old.
3. Run `claude plugin list`: dbview should say enabled. In a session, `/plugin` shows any error loading it.
4. The "userConfig option not yet set" note after install is harmless: `psql_path` defaults to `psql`.

## Use

```
/db                                   open the pane on every database it finds
/db connect postgres://u:p@host:5432/db [name]   save a database under a name (default: its database name)
/db forget <name>                     forget a saved database
/db refresh                           list the databases again and reload the open ones
```

The pane lists, in order: the databases saved with `/db connect`, the one named by `DATABASE_URL` or the `PG*` variables (unless a saved one is the same), then each running Postgres container. Press a database to unfold it (its catalog loads the first time), or pick one in the switcher at the top. Press a schema or folder to fold it, press a table to open it (press again to fold its columns), and filter the tree by table or column name. With the pane focused: `c`, `w`, `d` switch to Columns, Rows, DDL; `r` refreshes; `y` copies the DDL.

The pane follows its width: the tree and the open object sit side by side when it is wide, the object under the tree when it is narrow, and the tree takes about a third of a wide pane. Each panel scrolls on its own: the wheel moves the part under the pointer, and over the bar under the open object it moves the columns sideways. The ▴ ▾ ◂ ▸ steps at the ends of the bars do the same with a click.

## Update

```
claude plugin marketplace update claude-dbview
claude plugin update dbview@claude-dbview
```

Then run `/reload-plugins` in an open session, or start a new one. Installed from a local folder instead: `git pull` in that folder, then `/reload-plugins`.

## Needs

- For saved and `DATABASE_URL` databases: `psql` (the PostgreSQL client) on the machine running Claude Code. The engine looks on the PATH and in the usual Homebrew, Postgres.app and Linux locations; set another path with the `psql_path` option in `/config`.
- For containers: `docker` on that machine. The engine runs `docker exec … psql` inside the container as its `POSTGRES_USER` on its `POSTGRES_DB`, so it needs no published port, password or host psql.

## How it is built

- `types/index.d.ts`: the contract between the two sides (sources, catalog, relation detail, preview, DDL; the pane's view state).
- `hooks/engine/`: the server side. It runs inside the Claude Code CLI and talks to Postgres through `psql` (or `docker exec … psql`), one JSON document per request, built in SQL. The password travels in `PGPASSWORD`, never on a command line.
- `hooks/client/`: the client side. It draws the pane from one view value with the surface's own elements, so the same tree works on the terminal, desktop, VS Code and mobile.
- `hooks/register.tsx`: the seam between the two. It registers `/db` and the pane.

## Develop

```
claude plugin validate .
claude plugin test .                                    # pane tests on every surface, replaying recorded psql and docker answers
psql -f dev/seed.sql <db>                               # the sample database the checks expect
DATABASE_URL=postgres://... bun dev/engine-e2e.ts       # the engine against live Postgres and Docker (--record refreshes tests/fixtures.ts)
```

The e2e script also expects two containers seeded from `dev/seed.sql`, as a migration test leaves them:

```
docker run -d --name mig_before -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=shop -p 55431:5432 postgres:16
docker run -d --name mig_after  -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=shop -p 55432:5432 postgres:16
# seed both, then on mig_after:
#   alter table sales.orders add column shipped_at timestamptz;
#   create index orders_status_idx on sales.orders (status);
#   alter table sales.orders add constraint total_positive check (total >= 0);
```

## License

Free and open source under the MIT License. Copyright (c) 2026 [AGENTFLOW](https://agntflow.io), see [LICENSE](LICENSE).
