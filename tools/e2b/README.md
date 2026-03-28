# E2B Sandbox Scripts

These scripts create and run a full E2B sandbox for this Phoenix app, including:

- PostgreSQL via `docker compose` using Docker inside the sandbox
- Phoenix app on port `4000`
- OpenCode Web on port `4090`
- Optional E2B snapshot generation for fast re-launch

## 1) Install tool dependencies

```bash
bun install
```

Run this in `tools/e2b`.

## 2) Build a higher-memory template (recommended)

```bash
fnox exec -- bun run build-template.ts
```

Defaults:

- Template name: `doodle-sandbox`
- CPU: `2`
- Memory: `4096` MB

The template pre-installs build dependencies, `mise`, and Docker. Project tools (Erlang/Elixir/OpenCode) are then installed by `mise install` from this repo's `mise.toml` during sandbox provisioning.

Optional overrides:

```bash
E2B_TEMPLATE_NAME=doodle-sandbox E2B_TEMPLATE_CPU=2 E2B_TEMPLATE_MEMORY_MB=4096 fnox exec -- bun run build-template.ts
```

## 3) Create a sandbox and snapshot

```bash
E2B_TEMPLATE=doodle-sandbox fnox exec -- bun run sandbox.ts up
```

`up` tries the last saved snapshot first and falls back to full `create` automatically.

Resume from last snapshot only (fast path, no fallback):

```bash
fnox exec -- bun run sandbox.ts resume-last
```

or

```bash
fnox exec -- bun run sandbox.ts up --no-fallback
```

For the fastest startup, skip health waits:

```bash
fnox exec -- bun run sandbox.ts up --no-fallback --no-wait
```

Run OpenCode prompt in one or more fresh snapshot-based sandboxes (max 3):

```bash
E2B_OPENCODE_PROMPT="Implement task X" fnox exec -- bun run sandbox.ts run-prompt --count 2
```

Optional flags for prompt runs: `--model`, `--agent`, `--snapshot-id`.
Add `--no-wait` to return immediately after process start.

Start multiple concurrent sandboxes from snapshot (max 3):

```bash
fnox exec -- bun run sandbox.ts up-many --count 3
```

This path is intended for near-instant spin-up once a snapshot exists.

This command:

1. Creates a new E2B sandbox (from your template if provided)
2. Uploads this repository into `/home/user/doodle`
3. Verifies the template has required tooling
4. Builds/migrates the app using `mise x`
5. Starts Phoenix + OpenCode Web
6. Prints preview URLs
7. Creates a snapshot (unless `--no-snapshot` is used)

## 4) Resume from a snapshot

```bash
fnox exec -- bun run sandbox.ts resume --snapshot-id <snapshot-id>
```

## 5) Snapshot an existing running sandbox

```bash
fnox exec -- bun run sandbox.ts snapshot --sandbox-id <sandbox-id>
```

## 6) Clean up unused sandboxes

Dry-run (no deletion):

```bash
fnox exec -- bun run cleanup.ts
```

Delete matching sandboxes older than 24h:

```bash
fnox exec -- bun run cleanup.ts --hours 24 --execute
```

Delete across all projects (including running sandboxes):

```bash
fnox exec -- bun run cleanup.ts --all --execute
```

Delete sandboxes regardless of age (including new ones):

```bash
fnox exec -- bun run cleanup.ts --all --any-age --execute
```

The cleanup script targets sandboxes with metadata `project=doodle` by default.

## Useful flags

- `--template <template-or-snapshot-id>`: create from a specific template/snapshot
- `--no-snapshot`: skip snapshot creation in `create`
- `--count <1-3>` on `up-many`: number of concurrent sandboxes to launch
- `--all` on cleanup: includes all projects and running sandboxes
- `--any-age` on cleanup: ignores the age threshold

## Notes

- The script expects `E2B_API_KEY` in env. Use `fnox exec -- ...` to inject it.
- Sandbox timeout is set to 1 hour (E2B API limit for this flow).
- The sandbox should be created from a higher-memory template to allow `mise install` for Erlang/Elixir.
- `PHX_HOST` is set to the E2B host automatically to avoid redirects to `example.com`.
- OpenCode is started with: `opencode web --hostname 0.0.0.0 --port 4090`
- Logs are stored in `/home/user/doodle/.e2b/logs` inside sandbox.
- The sandbox starts `dockerd` and then runs `docker compose -f docker-compose.yml up -d postgres`.
- OpenCode and Mix are executed through `mise x` so versions come from `mise.toml`.
- The script no longer installs system tooling during sandbox creation; missing prerequisites fail fast with a template rebuild hint.
- Sandbox provisioning runs `mise install` (from repo `mise.toml`) after template verification.
