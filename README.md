# Doodle

This repository is just a test application for verifying sandboxes.

## Sandbox workflow (mise-first)

Common path:

```bash
mise sandbox --prompt "describe the change you want"
```

- Default behavior is snapshot-first for fast startup.
- If no snapshot exists (or resume fails), it falls back to full create + snapshot.
- Use `--recreate` to force full create + snapshot before running the prompt.

Related tasks:

```bash
mise tasks ls
mise sandbox-fast
mise sandbox-refresh
mise sandbox-template-build
mise sandbox-cleanup
```

Detailed E2B workflow docs live in `tools/e2b/README.md`.
Project and constraint notes from sandbox experiments live in `specs/sandboxer-learnings.md`.
