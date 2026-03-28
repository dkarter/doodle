# E2B Sandbox Workflow

This project uses E2B sandboxes to run Phoenix + OpenCode with a snapshot-first startup path.

## Quickstart (mise-first)

Run a prompt in a sandbox:

```bash
mise sandbox --prompt "implement feature X"
```

Default behavior:

1. Try last snapshot (fast path)
2. If snapshot is missing/invalid, create a fresh sandbox, build app, and create a new snapshot
3. Run `opencode run` with your full prompt

By default, prompt mode returns quickly and starts services in the background. Add `--wait` if you want blocking health checks.

Force full rebuild + new snapshot first:

```bash
mise sandbox --prompt "implement feature X" --recreate
```

Use a specific snapshot:

```bash
mise sandbox --prompt "implement feature X" --snapshot-id <snapshot-id>
```

## Task argument completion and help

The `sandbox` mise task defines a `usage` spec so shell completion/help works for:

- `--prompt <prompt>`
- `--recreate`
- `--snapshot-id <snapshot-id>`
- `--model <model>`
- `--agent <agent>`
- `--wait`

Inspect parsed task usage:

```bash
mise tasks info sandbox --json
```

Validate task config:

```bash
mise tasks validate
```

## Other sandbox tasks

```bash
mise sandbox-fast             # resume last snapshot only
mise sandbox-refresh          # full create + snapshot
mise sandbox-template-build   # build the E2B template
mise sandbox-cleanup          # dry-run cleanup
mise sandbox-cleanup-exec     # execute cleanup
mise sandbox-clear-snapshot   # clear local snapshot pointer
```

## SSH access

When a sandbox is ready, output includes:

```bash
ssh -o 'ProxyCommand=websocat --binary -B 65536 - wss://8081-%h.e2b.app' user@<sandbox-id>
```

Requirements:

- Local `websocat` installed (e.g. `brew install websocat`)
- Template built with SSH support (`openssh-server` + `websocat` proxy)

## Direct script usage (internal/developer detail)

If you need lower-level control, use:

```bash
fnox exec -- bun run ./tools/e2b/sandbox.ts help
```

Primary command set:

- `prompt --prompt <text> [--recreate] [--snapshot-id <id>] [--wait]`
- `up [--snapshot-id <id>] [--no-fallback]`
- `create [--template <template>]`
- `resume --snapshot-id <id>`
- `snapshot --sandbox-id <id>`
- `up-many --count <1-3>`

## Notes

- `E2B_API_KEY` must be provided via `fnox exec`.
- Default template alias is `doodle-sandbox`.
- Snapshot pointer is stored in `tools/e2b/.last_snapshot_id`.
- Live step UI is kept for TTY output; non-TTY output is now condensed and practical.
- Logs inside sandbox: `/home/user/doodle/.e2b/logs`.
