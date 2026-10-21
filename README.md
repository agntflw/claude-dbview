# dbview

A PostgreSQL database view for Claude Code, in a pane beside the chat. It shows your databases the way an IDE's explorer shows data sources: each database is a root, with its schemas as packages inside, then Tables, Views, Materialized views, Sequences and Functions folders, then the objects and their columns. Open a table or view to see:

- **Columns**: name, type, nullable, primary key or `→ schema.table(column)` reference, defaults, then the constraints (keys, foreign keys, checks, not null) and indexes.
- **Rows**: the first 50, 100, 500 or 1000 rows in key order, with the query shown.
- **DDL**: the table as a migration would create it (its sequences, the table with defaults and named constraints, indexes, `OWNED BY`), numbered, with Copy.

Every Postgres container Docker is running shows up by itself, so the databases a migration test leaves behind (say `mig_before` and `mig_after`) sit side by side in the tree to compare.

Everything is read-only: each request runs in a read-only session with a 10 second statement timeout.

## Install

At the prompt of a terminal session:

```
/plugin install dbview --marketplace agntflw/claude-dbview
```

Answer `y` to add the marketplace, then pick a scope (user is the first). From a shell:

```
claude plugin install dbview --marketplace agntflw/claude-dbview
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `agntflw/claude-dbview`, then Add plugin.

This repository is private: it installs only for people who can read it on GitHub and whose machine already holds a git credential for github.com (an SSH key, or `gh auth login` then `gh auth setup-git`).

## Use

```
/db                                   open the pane on every database it finds
/db connect postgres://u:p@host:5432/db [name]   save a database under a name (default: its database name)
/db forget <name>                     forget a saved database
/db refresh                           list the databases again and reload the open ones
```

The pane lists, in order: the databases saved with `/db connect`, the one named by `DATABASE_URL` or the `PG*` variables (unless a saved one is the same), then each running Postgres container. Press a database to unfold it (its catalog loads the first time), or pick one in the switcher at the top. Press a schema or folder to fold it, press a table to open it (press again to fold its columns), and filter the tree by table or column name. With the pane focused: `c`, `w`, `d` switch to Columns, Rows, DDL; `r` refreshes; `y` copies the DDL.

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
