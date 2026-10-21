# dbview

A PostgreSQL database view for Claude Code, in a pane beside the chat. It shows your database the way an IDE shows a project: schemas are the top-level packages, with Tables, Views, Materialized views, Sequences and Functions folders inside, then the objects, then their columns. Open a table or view to see its columns, its first 50 rows, or its DDL.

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
/db connect postgres://user:password@host:5432/database
/db              open the pane (uses the saved URL, else DATABASE_URL, else the PG* variables)
/db refresh      reload the tree
/db disconnect   forget the saved URL
```

In the pane: press a schema or folder to fold it, press a table to open it (press again to fold its columns), switch between Columns, Rows and DDL, and filter the tree by table or column name. `r` refreshes when the pane has focus.

## Needs

`psql` (the PostgreSQL client) on the machine running Claude Code. The engine looks on the PATH and in the usual Homebrew, Postgres.app and Linux locations; set another path with the `psql_path` option in `/config`.

## How it is built

- `types/index.d.ts`: the contract between the two sides (catalog, columns, preview, DDL; the pane's view state).
- `hooks/engine/`: the server side. It runs inside the Claude Code CLI and talks to Postgres through `psql`, one JSON document per request, built in SQL. The password travels in `PGPASSWORD`, never on a command line.
- `hooks/client/`: the client side. It draws the pane from one view value with the surface's own elements, so the same tree works on the terminal, desktop, VS Code and mobile.
- `hooks/register.tsx`: the seam between the two. It registers `/db` and the pane.

## Develop

```
claude plugin validate .
claude plugin test .                                    # pane tests on every surface, replaying recorded psql answers
psql -f dev/seed.sql <db>                               # the sample database the checks expect
DATABASE_URL=postgres://... bun dev/engine-e2e.ts       # the engine against a live Postgres (--record refreshes tests/fixtures.ts)
```
