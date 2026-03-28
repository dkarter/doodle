# Sandboxer Goals and Learned Constraints

Date: 2026-03-28

## Project goals

1. Fast sandbox startup for prompt-driven coding loops
2. Mise-first user UX (`mise sandbox --prompt ...`)
3. Snapshot lifecycle that is safe by default and recoverable
4. Clear operational visibility (logs, web UI, runtime checks)
5. Safe cleanup and explicit destructive paths

## Fast snapshot-first startup

Design:

- Default prompt workflow attempts resume from `tools/e2b/.last_snapshot_id` first.
- If snapshot is missing or resume fails, it falls back to full create + snapshot.
- `--recreate` forces full create + snapshot before prompt execution.

Why:

- Resume path is usually seconds.
- Full create path can take several minutes because it verifies template prerequisites, installs mise tools, starts dockerized Postgres, compiles, migrates, and starts services.

## Prompt-driven sandbox agents

Primary path:

```bash
mise sandbox --prompt "<your prompt>"
```

Constraint learned:

- Prompt argument must be treated as a single shell-safe unit end-to-end.
- Nested shell quoting can silently truncate arguments or pass an empty prompt.

Fix applied:

- Prompt is required as CLI flag (`--prompt`), not env fallback for the common path.
- Command quoting in `sandbox.ts` now uses one shell-quoted script boundary and shell-quoted prompt argument.

## Websocket/proxy pitfalls and fixes

### Phoenix websocket / live updates

Observed pitfall:

- Incorrect LiveView/proxy config can make the page appear reachable but break live event flow.

Fix already used in runtime env:

- `DISABLE_FORCE_SSL=1`
- `DISABLE_WS_ORIGIN_CHECK=1`
- `PHX_HOST` set from `sandbox.getHost(APP_PORT)`

Playwright verification:

- Evaluated `window.liveSocket?.isConnected?.()` => `true`
- Counter live updates (button clicks changing value) confirmed in browser.

### SSH over websocket proxy

Design:

- Template includes `openssh-server` and a `websocat` websocket tunnel on port `8081`.
- Sandbox output prints ready-to-run SSH command.

Command format:

```bash
ssh -o 'ProxyCommand=websocat --binary -B 65536 - wss://8081-%h.e2b.app' user@<sandbox-id>
```

## Template vs runtime responsibilities

Template responsibilities:

- Provide heavy/static prerequisites once (build deps, docker, mise, ssh/websocat)

Runtime responsibilities:

- Upload current repo state
- Trust and install tools via repo `mise.toml`
- Build/migrate app
- Start services and run prompt

Constraint learned:

- Running without a prepared template causes repeated setup failures and slow startup.
- Default alias `doodle-sandbox` keeps the normal path deterministic.

## Cleanup workflow and safety

Current safety model:

- `mise sandbox-cleanup` is dry-run by default.
- `mise sandbox-cleanup-exec` is explicit destructive mode.
- Filters by project metadata by default.

Guideline:

- Keep unsafe cleanup options opt-in (`--execute`, `--all`, `--any-age`).

## Prompt verification notes (exact prompt)

Prompt used exactly:

```text
add confetti whenever the user presses the increment button and raining sad emojis when they press the decrement button
```

Where full prompt was verified:

1. Local task output (`mise sandbox ...`) echoed the full prompt string.
2. OpenCode runtime log in sandbox:
   - `/home/user/.local/share/opencode/log/2026-03-28T014746.log`
   - contains args array with full prompt text.
3. OpenCode run output log path printed by sandbox script:
   - `/home/user/doodle/.e2b/logs/opencode-run-1774662460862-1.log`
   - captures the agent run transcript.

## Playwright evidence notes

- OpenCode web reachable at `https://4090-<sandbox-id>.e2b.app`.
- Phoenix app reachable at `https://4000-<sandbox-id>.e2b.app`.
- Live socket connected status on app page verified via browser evaluation.
- OpenCode HTTP/session endpoints responded successfully from browser network inspection.

## Operational caveats

- Full `--recreate` path remains slower due dependency install and build.
- Snapshot creation may occasionally be slow; retry logic is used for resilience.
- `opencode run` is non-interactive; prompt is most reliably audited in OpenCode logs.
