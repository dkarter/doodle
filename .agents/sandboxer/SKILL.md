# sandboxer

Purpose: spin up a prompt in a new sandbox and monitor progress.

## When to use

- You need to run a coding prompt in an isolated E2B sandbox.
- You need a fast snapshot-first startup path.
- You need to monitor OpenCode run output and inspect logs/web UI.

## Default workflow

1. Run:

```bash
mise sandbox --prompt "<prompt>"
```

2. If you need a guaranteed fresh rebuild, run:

```bash
mise sandbox --prompt "<prompt>" --recreate
```

3. Capture output fields:

- Sandbox ID
- App URL
- OpenCode Web URL
- SSH command
- Prompt log path

## Monitoring checklist

### During startup

- Watch step progress from `sandbox.ts` output.
- Confirm fast path if snapshot exists (`Trying snapshot ...`).
- If fallback occurs, confirm create/build/migrate/snapshot steps complete.

### After prompt run starts

- Inspect logs via SSH or E2B command execution:

- `/home/user/doodle/.e2b/logs/opencode-run-*.log`
- `/home/user/doodle/.e2b/logs/opencode.log`
- `/home/user/doodle/.e2b/logs/phoenix.log`

### OpenCode prompt audit

Check where prompt appears:

- OpenCode log files under `/home/user/.local/share/opencode/log/`
- Session/storage DB under `/home/user/.local/share/opencode/`

## Web UI inspection

- Open app URL (`4000-...`) for product behavior checks.
- Open OpenCode URL (`4090-...`) for session status.
- Use Playwright for reproducible checks:
  - Page load success
  - Live updates / websocket-connected behavior
  - Expected UI response to prompt changes

## SSH usage

Use printed command:

```bash
ssh -o 'ProxyCommand=websocat --binary -B 65536 - wss://8081-%h.e2b.app' user@<sandbox-id>
```

Prereq: local `websocat` installed.

## Safety

- Prefer snapshot-first path for speed.
- Use `--recreate` only when needed.
- Keep cleanup destructive actions explicit (`sandbox-cleanup-exec`).
