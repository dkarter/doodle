import Sandbox from "e2b";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { StepRenderer } from "./step_renderer";

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

const APP_PORT = Number(process.env.E2B_APP_PORT ?? 4000);
const OPENCODE_PORT = Number(process.env.E2B_OPENCODE_PORT ?? 4090);
const SSH_PROXY_PORT = Number(process.env.E2B_SSH_PROXY_PORT ?? 8081);
const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const REMOTE_ROOT = "/home/user/doodle";
const E2B_DIR = `${REMOTE_ROOT}/.e2b`;
const MISE_BIN = "/home/user/.local/bin/mise";
const DEFAULT_TEMPLATE = process.env.E2B_TEMPLATE ?? "doodle-sandbox";
const LAST_SNAPSHOT_FILE = resolve(import.meta.dir, ".last_snapshot_id");
const E2B_GIT_USERNAME = process.env.E2B_GIT_USERNAME ?? "x-access-token";
const E2B_GIT_TOKEN = process.env.E2B_GIT_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const stepUI = new StepRenderer();
const UNSAFE_REMOTE_ROOTS = new Set(["/", "/home", "/home/user"]);

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const SANDBOX_TIMEOUT_MS = 60 * 60 * 1000;
const ELIXIR_ERL_OPTIONS = "+fnu";

function usage() {
  console.log(`
Usage:
  bun run sandbox.ts up [--snapshot-id <snapshot-id>] [--no-fallback] [--no-wait]
  bun run sandbox.ts prompt --prompt <text> [--snapshot-id <snapshot-id>] [--recreate] [--model <provider/model>] [--agent <agent>] [--wait]
  bun run sandbox.ts resume-last
  bun run sandbox.ts up-many [--count <1-3>] [--snapshot-id <snapshot-id>] [--no-wait]
  bun run sandbox.ts run-prompt [--count <1-3>] [--snapshot-id <snapshot-id>] [--prompt <text>] [--model <provider/model>] [--agent <agent>] [--no-wait]
  bun run sandbox.ts create [--template <template-or-snapshot-id>] [--no-snapshot]
  bun run sandbox.ts resume --snapshot-id <snapshot-id>
  bun run sandbox.ts snapshot --sandbox-id <sandbox-id>

Examples:
  fnox exec -- bun run sandbox.ts up
  fnox exec -- bun run sandbox.ts up --no-fallback
  fnox exec -- bun run sandbox.ts resume-last
  fnox exec -- bun run sandbox.ts prompt --prompt "Fix flaky tests"
  fnox exec -- bun run sandbox.ts prompt --prompt "Fix flaky tests" --recreate
  fnox exec -- bun run sandbox.ts up-many --count 3
  fnox exec -- bun run sandbox.ts run-prompt --count 2 --prompt "Fix flaky tests"
  fnox exec -- bun run sandbox.ts create
  fnox exec -- bun run sandbox.ts create --template my-template
  fnox exec -- bun run sandbox.ts resume --snapshot-id snp_123
  fnox exec -- bun run sandbox.ts snapshot --sandbox-id sbx_123

Notes:
  - E2B_API_KEY must be injected via fnox.
  - Prompt command requires --prompt and defaults to snapshot fast path.
  - For enough memory, build a template and set E2B_TEMPLATE (or pass --template).
  - Snapshot IDs are stored in ${LAST_SNAPSHOT_FILE}.
  - The script clones this repository into the sandbox at ${REMOTE_ROOT}.
  - Snapshot-based launches pull latest commits in that repo before starting services.
  - It starts Phoenix and OpenCode Web, then prints both preview URLs.
`);
}

function getFlag(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  if (index === -1) return undefined;
  return Bun.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return Bun.argv.includes(name);
}

function parseCount(): number {
  const raw = getFlag("--count") ?? "1";
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 3) {
    throw new Error("--count must be an integer between 1 and 3");
  }

  return value;
}

function getPrompt(): string {
  const prompt = getFlag("--prompt");

  if (!prompt || prompt.trim().length === 0) {
    throw new Error("Missing prompt. Pass --prompt <text>.");
  }

  return prompt;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function assertApiKey() {
  if (!process.env.E2B_API_KEY) {
    throw new Error("E2B_API_KEY is missing. Run the script with fnox exec.");
  }
}

async function runChecked(
  sandbox: Sandbox,
  command: string,
  opts: {
    cwd?: string;
    timeoutMs?: number;
    envs?: Record<string, string>;
    user?: string;
  } = {},
): Promise<CommandResult> {
  let result: CommandResult;
  let stdoutRemainder = "";
  let stderrRemainder = "";

  const pushLines = (chunk: string, isError: boolean) => {
    const previous = isError ? stderrRemainder : stdoutRemainder;
    const combined = `${previous}${chunk}`;
    const parts = combined.split(/\r?\n/);
    const tail = parts.pop() ?? "";

    for (const line of parts) {
      stepUI.appendLog(line, isError);
    }

    if (isError) {
      stderrRemainder = tail;
    } else {
      stdoutRemainder = tail;
    }
  };

  const flushRemainders = () => {
    if (stdoutRemainder.trim()) {
      stepUI.appendLog(stdoutRemainder, false);
    }
    if (stderrRemainder.trim()) {
      stepUI.appendLog(stderrRemainder, true);
    }
    stdoutRemainder = "";
    stderrRemainder = "";
  };

  try {
    result = (await sandbox.commands.run(command, {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      envs: opts.envs,
      user: opts.user,
      onStdout: (data) => pushLines(data, false),
      onStderr: (data) => pushLines(data, true),
    })) as unknown as CommandResult;
    flushRemainders();
  } catch (error) {
    flushRemainders();
    const commandError = error as {
      result?: { exitCode?: number; stdout?: string; stderr?: string };
      message?: string;
    };

    if (commandError.result) {
      const stderr = commandError.result.stderr?.trim();
      const stdout = commandError.result.stdout?.trim();
      const details = [stderr, stdout].filter(Boolean).join("\n") || "(no output)";
      const exitCode = commandError.result.exitCode ?? "unknown";
      throw new Error(`Command failed (${exitCode}): ${command}\n${details}`);
    }

    throw error;
  }

  if (result.exitCode !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    const details = [stderr, stdout].filter(Boolean).join("\n") || "(no output)";
    throw new Error(`Command failed (${result.exitCode}): ${command}\n${details}`);
  }

  return result;
}

async function runWithExitCode(
  sandbox: Sandbox,
  command: string,
  opts: {
    cwd?: string;
    timeoutMs?: number;
    envs?: Record<string, string>;
    user?: string;
  } = {},
): Promise<CommandResult> {
  let stdoutRemainder = "";
  let stderrRemainder = "";

  const pushLines = (chunk: string, isError: boolean) => {
    const previous = isError ? stderrRemainder : stdoutRemainder;
    const combined = `${previous}${chunk}`;
    const parts = combined.split(/\r?\n/);
    const tail = parts.pop() ?? "";

    for (const line of parts) {
      stepUI.appendLog(line, isError);
    }

    if (isError) {
      stderrRemainder = tail;
    } else {
      stdoutRemainder = tail;
    }
  };

  try {
    const result = (await sandbox.commands.run(command, {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      envs: opts.envs,
      user: opts.user,
      onStdout: (data) => pushLines(data, false),
      onStderr: (data) => pushLines(data, true),
    })) as unknown as CommandResult;

    if (stdoutRemainder.trim()) {
      stepUI.appendLog(stdoutRemainder, false);
    }
    if (stderrRemainder.trim()) {
      stepUI.appendLog(stderrRemainder, true);
    }

    return result;
  } catch (error) {
    const commandError = error as {
      result?: { exitCode?: number; stdout?: string; stderr?: string };
    };

    if (commandError.result) {
      return {
        exitCode: commandError.result.exitCode ?? 1,
        stdout: commandError.result.stdout ?? "",
        stderr: commandError.result.stderr ?? "",
      };
    }

    throw error;
  }
}

async function withStep<T>(title: string, action: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  stepUI.startStep(title);
  try {
    const result = await action();
    stepUI.finishStep("done", `${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    return result;
  } catch (error) {
    stepUI.finishStep("failed", `${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    throw error;
  }
}

async function runLocalGit(
  localRoot: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const process = Bun.spawn(["git", "-C", localRoot, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return { stdout, stderr, exitCode };
}

function normalizeGitRemoteForClone(remoteUrl: string): string {
  const sshScpLike = remoteUrl.match(/^git@([^:]+):(.+)$/);
  if (sshScpLike) {
    return `https://${sshScpLike[1]}/${sshScpLike[2]}`;
  }

  const sshUrl = remoteUrl.match(/^ssh:\/\/git@([^/]+)\/(.+)$/);
  if (sshUrl) {
    return `https://${sshUrl[1]}/${sshUrl[2]}`;
  }

  return remoteUrl;
}

function gitAuthOptsForRemote(remoteUrl: string): {
  username: string;
  password: string;
} | undefined {
  if (!remoteUrl.startsWith("https://") || !E2B_GIT_TOKEN) {
    return undefined;
  }

  return {
    username: E2B_GIT_USERNAME,
    password: E2B_GIT_TOKEN,
  };
}

async function cloneProjectFromGit(sandbox: Sandbox, localRoot: string) {
  const remoteResult = await runLocalGit(localRoot, ["config", "--get", "remote.origin.url"]);
  const remoteUrl = remoteResult.stdout.trim();

  if (remoteResult.exitCode !== 0 || !remoteUrl) {
    const details = remoteResult.stderr.trim() || "(no output)";
    throw new Error(`Unable to resolve git remote origin URL from ${localRoot}.\n${details}`);
  }

  const branchResult = await runLocalGit(localRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchResult.stdout.trim();
  const detachedHead = branch === "HEAD";

  const statusResult = await runLocalGit(localRoot, ["status", "--porcelain"]);
  const dirty = statusResult.stdout.trim().length > 0;
  if (dirty) {
    stepUI.appendLog(
      "Local working tree has uncommitted changes; sandbox clone uses only commits available in the remote.",
      true,
    );
  }

  const cloneUrl = normalizeGitRemoteForClone(remoteUrl);
  const gitAuth = gitAuthOptsForRemote(cloneUrl);

  stepUI.appendLog(`Cloning repository ${remoteUrl}`);
  const remoteRootExists = await sandbox.files.exists(REMOTE_ROOT);
  if (remoteRootExists) {
    const remoteRoot = String(REMOTE_ROOT);
    if (UNSAFE_REMOTE_ROOTS.has(remoteRoot)) {
      throw new Error(`Refusing to remove unsafe remote path: ${REMOTE_ROOT}`);
    }
    await runChecked(sandbox, `rm -rf ${shQuote(REMOTE_ROOT)}`);
  }

  await sandbox.git.clone(cloneUrl, {
    path: REMOTE_ROOT,
    branch: detachedHead ? undefined : branch,
    ...gitAuth,
  });

  if (detachedHead) {
    stepUI.appendLog("Local HEAD is detached; cloned repository default branch in sandbox.", true);
  }
}

async function pullProjectFromGit(sandbox: Sandbox) {
  if (!(await sandbox.files.exists(REMOTE_ROOT))) {
    throw new Error(
      `Project directory ${REMOTE_ROOT} is missing in snapshot sandbox; recreate the snapshot with 'bun run sandbox.ts create'.`,
    );
  }

  const originUrl = await sandbox.git.remoteGet(REMOTE_ROOT, "origin");
  if (!originUrl) {
    throw new Error(
      `Repository at ${REMOTE_ROOT} is missing origin remote; recreate the snapshot.`,
    );
  }

  const gitAuth = gitAuthOptsForRemote(originUrl);

  stepUI.appendLog(`Pulling latest commits from ${originUrl}`);
  await sandbox.git.pull(REMOTE_ROOT, {
    ...gitAuth,
  });
}

async function readLastSnapshotId(): Promise<string | null> {
  try {
    const raw = await readFile(LAST_SNAPSHOT_FILE, "utf8");
    const value = raw.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function writeLastSnapshotId(snapshotId: string) {
  await writeFile(LAST_SNAPSHOT_FILE, `${snapshotId}\n`, "utf8");
}

async function installSystemDependencies(sandbox: Sandbox) {
  stepUI.appendLog("Checking toolchain and runtime prerequisites");

  const checks: Array<{ name: string; result: CommandResult }> = [
    {
      name: "build toolchain",
      result: await runWithExitCode(
        sandbox,
        "bash -lc 'command -v gcc >/dev/null 2>&1 && command -v make >/dev/null 2>&1 && command -v javac >/dev/null 2>&1 && command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1'",
        { user: "root" },
      ),
    },
    {
      name: "mise binary",
      result: await runWithExitCode(sandbox, `test -x ${MISE_BIN}`),
    },
    {
      name: "docker binary",
      result: await runWithExitCode(sandbox, "command -v docker >/dev/null 2>&1", {
        user: "root",
      }),
    },
  ];

  const failed = checks.filter((check) => check.result.exitCode !== 0);

  if (failed.length > 0) {
    const names = failed.map((check) => check.name).join(", ");
    throw new Error(
      `Template is missing prerequisites: ${names}. Rebuild template with 'mise sandbox-template-build' and run again.`,
    );
  }

  await runChecked(sandbox, `${MISE_BIN} trust -y ${REMOTE_ROOT}/mise.toml`);
  await runChecked(sandbox, `MISE_JOBS=1 ${MISE_BIN} install`, {
    cwd: REMOTE_ROOT,
    timeoutMs: 50 * 60 * 1000,
  });
}

async function ensureDockerDaemon(sandbox: Sandbox) {
  await runChecked(
    sandbox,
    "bash -lc 'if command -v service >/dev/null 2>&1; then service docker start || true; fi; pgrep -x dockerd >/dev/null 2>&1 || nohup dockerd >/tmp/dockerd.log 2>&1 &'",
    {
      user: "root",
      timeoutMs: 10 * 60 * 1000,
    },
  );

  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const result = (await sandbox.commands.run("docker info >/dev/null 2>&1", {
      timeoutMs: 10_000,
      user: "root",
    })) as unknown as CommandResult;

    if (result.exitCode === 0) {
      return;
    }

    await Bun.sleep(2_000);
  }

  throw new Error("Docker daemon did not become ready");
}

async function setupDatabaseWithDockerCompose(sandbox: Sandbox) {
  await ensureDockerDaemon(sandbox);

  await runChecked(
    sandbox,
    `docker compose -f ${REMOTE_ROOT}/docker-compose.yml up -d postgres`,
    {
      user: "root",
      timeoutMs: 10 * 60 * 1000,
    },
  );

  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const result = await runWithExitCode(
      sandbox,
      `docker compose -f ${REMOTE_ROOT}/docker-compose.yml exec -T postgres pg_isready -U postgres -d doodle_dev`,
      {
        user: "root",
        timeoutMs: 10_000,
      },
    );

    if (result.exitCode === 0) {
      return;
    }

    if (attempt % 10 === 0) {
      console.log(`  waiting for postgres (${attempt}/60)`);
    }
    await Bun.sleep(2_000);
  }

  throw new Error("PostgreSQL container did not become healthy via Docker Compose");
}

async function setupProject(sandbox: Sandbox) {
  stepUI.appendLog("Verifying OpenCode and Mix toolchain");
  await runChecked(sandbox, `MISE_JOBS=1 ${MISE_BIN} x -C ${REMOTE_ROOT} -- opencode --version`, {
    timeoutMs: 20 * 60 * 1000,
  });

  stepUI.appendLog("Fetching and compiling Elixir dependencies");
  await runChecked(sandbox, `MISE_JOBS=1 ${MISE_BIN} x -C ${REMOTE_ROOT} -- mix local.hex --force`);
  await runChecked(
    sandbox,
    `MISE_JOBS=1 ${MISE_BIN} x -C ${REMOTE_ROOT} -- mix local.rebar --force`,
  );
  await runChecked(
    sandbox,
    `MISE_JOBS=1 ${MISE_BIN} x -C ${REMOTE_ROOT} -- env ELIXIR_ERL_OPTIONS=${ELIXIR_ERL_OPTIONS} DISABLE_FORCE_SSL=1 DISABLE_WS_ORIGIN_CHECK=1 MIX_ENV=dev mix deps.get`,
  );
  await runChecked(
    sandbox,
    `MISE_JOBS=1 ${MISE_BIN} x -C ${REMOTE_ROOT} -- env ELIXIR_ERL_OPTIONS=${ELIXIR_ERL_OPTIONS} DISABLE_FORCE_SSL=1 DISABLE_WS_ORIGIN_CHECK=1 MIX_ENV=dev mix deps.compile`,
    {
      timeoutMs: 30 * 60 * 1000,
    },
  );
  await runChecked(
    sandbox,
    `MISE_JOBS=1 ${MISE_BIN} x -C ${REMOTE_ROOT} -- env ELIXIR_ERL_OPTIONS=${ELIXIR_ERL_OPTIONS} DISABLE_FORCE_SSL=1 DISABLE_WS_ORIGIN_CHECK=1 MIX_ENV=dev mix compile`,
  );
  await runChecked(
    sandbox,
    `MISE_JOBS=1 ${MISE_BIN} x -C ${REMOTE_ROOT} -- env ELIXIR_ERL_OPTIONS=${ELIXIR_ERL_OPTIONS} DISABLE_FORCE_SSL=1 DISABLE_WS_ORIGIN_CHECK=1 MIX_ENV=dev mix assets.setup`,
    {
      timeoutMs: 20 * 60 * 1000,
    },
  );

  const secretResult = await runChecked(
    sandbox,
    `MISE_JOBS=1 ${MISE_BIN} x -C ${REMOTE_ROOT} -- mix phx.gen.secret`,
  );
  const secretKeyBase = secretResult.stdout.trim().split("\n").at(-1) ?? "";

  if (!secretKeyBase) {
    throw new Error("Failed to generate SECRET_KEY_BASE");
  }

  const runtimeEnv = [
    "APP_PORT=4000",
    "OPENCODE_PORT=4090",
    `PHX_HOST=${sandbox.getHost(APP_PORT)}`,
    "DATABASE_URL=ecto://postgres:postgres@localhost/doodle_dev",
    `ELIXIR_ERL_OPTIONS=${ELIXIR_ERL_OPTIONS}`,
    "DISABLE_FORCE_SSL=1",
    "DISABLE_WS_ORIGIN_CHECK=1",
    `SECRET_KEY_BASE=${secretKeyBase}`,
  ].join("\n");

  const startScript = `#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${REMOTE_ROOT}"
E2B_DIR="${E2B_DIR}"
LOG_DIR="$E2B_DIR/logs"
mkdir -p "$LOG_DIR"

set -a
source "$E2B_DIR/runtime.env"
set +a
cd "$APP_DIR"

if pgrep -f "mix phx.server" >/dev/null 2>&1 && pgrep -f "opencode web --hostname 0.0.0.0 --port $OPENCODE_PORT" >/dev/null 2>&1; then
  exit 0
fi

if command -v service >/dev/null 2>&1; then
  service docker start >/dev/null 2>&1 || true
fi
pgrep -x dockerd >/dev/null 2>&1 || nohup dockerd >/tmp/dockerd.log 2>&1 &

for i in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

docker compose -f "$APP_DIR/docker-compose.yml" up -d postgres >/dev/null 2>&1 || true

if ! pgrep -f "mix phx.server" >/dev/null 2>&1; then
  nohup bash -lc "cd $APP_DIR && MISE_JOBS=1 ${MISE_BIN} x -C $APP_DIR -- env ELIXIR_ERL_OPTIONS=$ELIXIR_ERL_OPTIONS DISABLE_FORCE_SSL=$DISABLE_FORCE_SSL DISABLE_WS_ORIGIN_CHECK=$DISABLE_WS_ORIGIN_CHECK PHX_SERVER=true MIX_ENV=dev PORT=$APP_PORT PHX_HOST=$PHX_HOST DATABASE_URL=$DATABASE_URL SECRET_KEY_BASE=$SECRET_KEY_BASE mix phx.server" > "$LOG_DIR/phoenix.log" 2>&1 &
fi

if ! pgrep -f "opencode web --hostname 0.0.0.0 --port $OPENCODE_PORT" >/dev/null 2>&1; then
  nohup bash -lc "cd $APP_DIR && MISE_JOBS=1 ${MISE_BIN} x -C $APP_DIR -- opencode web --hostname 0.0.0.0 --port $OPENCODE_PORT" > "$LOG_DIR/opencode.log" 2>&1 &
fi
`;

  await runChecked(sandbox, `mkdir -p ${E2B_DIR}`);
  await sandbox.files.write(`${E2B_DIR}/runtime.env`, runtimeEnv);
  await sandbox.files.write(`${E2B_DIR}/start-services.sh`, startScript);
  await runChecked(sandbox, `chmod +x ${E2B_DIR}/start-services.sh`);

  stepUI.appendLog("Running migrations");
  await runChecked(
    sandbox,
    `MISE_JOBS=1 ${MISE_BIN} x -C ${REMOTE_ROOT} -- env ELIXIR_ERL_OPTIONS=${ELIXIR_ERL_OPTIONS} DISABLE_FORCE_SSL=1 DISABLE_WS_ORIGIN_CHECK=1 SECRET_KEY_BASE=${secretKeyBase} DATABASE_URL=ecto://postgres:postgres@localhost/doodle_dev MIX_ENV=dev mix ecto.migrate`,
  );
}

async function waitForHttp(
  sandbox: Sandbox,
  port: number,
  label: string,
  retries = 60,
) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const result = await runWithExitCode(
      sandbox,
      `curl -sS --max-time 2 -o /dev/null http://127.0.0.1:${port}`,
      { timeoutMs: 10_000 },
    );

    if (result.exitCode === 0) {
      return;
    }

    await Bun.sleep(2_000);
    if (attempt % 10 === 0) {
      console.log(`  waiting for ${label} (${attempt}/${retries})`);
    }
  }

  throw new Error(`${label} did not become healthy on port ${port}`);
}

async function createSnapshotWithRetry(sandbox: Sandbox, attempts = 3) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await sandbox.createSnapshot({ requestTimeoutMs: 5 * 60 * 1000 });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const message = error instanceof Error ? error.message : String(error);
        stepUI.appendLog(`Snapshot attempt ${attempt} failed: ${message}`, true);
        await Bun.sleep(5_000);
      }
    }
  }

  throw lastError;
}

function printResult(sandbox: Sandbox, snapshotId?: string) {
  const appUrl = `https://${sandbox.getHost(APP_PORT)}`;
  const opencodeUrl = `https://${sandbox.getHost(OPENCODE_PORT)}`;
  const sshCommand =
    `ssh -o 'ProxyCommand=websocat --binary -B 65536 - wss://${SSH_PROXY_PORT}-%h.e2b.app' user@${sandbox.sandboxId}`;

  console.log("\nSandbox ready");
  console.log(`- Sandbox ID: ${sandbox.sandboxId}`);
  console.log(`- App URL: ${appUrl}`);
  console.log(`- OpenCode Web URL: ${opencodeUrl}`);
  console.log(`- SSH: ${sshCommand}`);
  if (snapshotId) {
    console.log(`- Snapshot ID: ${snapshotId}`);
  }

  console.log("\nTo continue coding inside this sandbox, open OpenCode Web URL.");
}

async function startServices(sandbox: Sandbox, opts: { waitForHealth: boolean }) {
  if (!opts.waitForHealth) {
    await runChecked(
      sandbox,
      `bash -lc 'nohup ${E2B_DIR}/start-services.sh > ${E2B_DIR}/logs/bootstrap.log 2>&1 &'`,
    );
    return;
  }

  await runChecked(sandbox, `${E2B_DIR}/start-services.sh`);
  await waitForHttp(sandbox, APP_PORT, "Phoenix");
  await waitForHttp(sandbox, OPENCODE_PORT, "OpenCode Web");
}

async function createSandbox(opts: { printResult?: boolean } = {}) {
  assertApiKey();
  const shouldPrintResult = opts.printResult ?? true;

  const template = getFlag("--template") ?? DEFAULT_TEMPLATE;
  const shouldCreateSnapshot = !hasFlag("--no-snapshot");

  console.log("Creating sandbox");
  const createStartedAt = Date.now();
  const sandbox = template
    ? await Sandbox.create(template, {
      timeoutMs: SANDBOX_TIMEOUT_MS,
      metadata: { project: "doodle", purpose: "app-sandbox" },
    })
    : await Sandbox.create({
      timeoutMs: SANDBOX_TIMEOUT_MS,
      metadata: { project: "doodle", purpose: "app-sandbox" },
    });

  console.log(
    `- Sandbox created: ${sandbox.sandboxId} (${formatSeconds(Date.now() - createStartedAt)})`,
  );
  const info = await sandbox.getInfo();
  console.log(`- Sandbox resources: ${info.cpuCount} CPU / ${info.memoryMB} MB RAM`);

  await withStep("Clone project", () => cloneProjectFromGit(sandbox, PROJECT_ROOT));
  await withStep("Verify template prerequisites", () => installSystemDependencies(sandbox));
  await withStep("Start PostgreSQL", () => setupDatabaseWithDockerCompose(sandbox));
  await withStep("Build app and migrate", () => setupProject(sandbox));
  await withStep(
    "Start Phoenix and OpenCode",
    () => startServices(sandbox, { waitForHealth: true }),
  );

  let snapshotId: string | undefined;
  let activeSandbox = sandbox;
  if (shouldCreateSnapshot) {
    const snapshot = await withStep("Create snapshot", () => createSnapshotWithRetry(sandbox));
    snapshotId = snapshot.snapshotId;
    await writeLastSnapshotId(snapshot.snapshotId);

    const resumed = await withStep(
      "Resume fresh sandbox from snapshot",
      () =>
        Sandbox.create(snapshot.snapshotId, {
          timeoutMs: SANDBOX_TIMEOUT_MS,
          metadata: { project: "doodle", purpose: "app-sandbox" },
        }),
    );
    await withStep(
      "Start Phoenix and OpenCode (resumed)",
      () => startServices(resumed, { waitForHealth: true }),
    );
    activeSandbox = resumed;
  }

  if (shouldPrintResult) {
    printResult(activeSandbox, snapshotId);
  }

  return { sandbox: activeSandbox, snapshotId };
}

async function resumeFromSnapshot(
  snapshotIdArg?: string,
  opts: { printResult?: boolean; waitForHealth?: boolean } = {},
) {
  assertApiKey();
  const shouldPrintResult = opts.printResult ?? true;
  const waitForHealth = opts.waitForHealth ?? !hasFlag("--no-wait");

  const snapshotId = snapshotIdArg ?? getFlag("--snapshot-id");
  if (!snapshotId) {
    throw new Error("Missing --snapshot-id");
  }

  console.log(`Creating sandbox from snapshot ${snapshotId}`);
  const resumeStartedAt = Date.now();
  const sandbox = await Sandbox.create(snapshotId, {
    timeoutMs: SANDBOX_TIMEOUT_MS,
    metadata: { project: "doodle", purpose: "app-sandbox" },
  });
  console.log(`- Snapshot resumed in ${formatSeconds(Date.now() - resumeStartedAt)}`);

  await writeLastSnapshotId(snapshotId);
  await withStep("Update project from git", () => pullProjectFromGit(sandbox));
  await withStep(
    "Start Phoenix and OpenCode",
    () => startServices(sandbox, { waitForHealth }),
  );
  if (shouldPrintResult) {
    printResult(sandbox);
  }

  return sandbox;
}

async function upSandbox() {
  const explicitSnapshotId = getFlag("--snapshot-id");
  const noFallback = hasFlag("--no-fallback");
  const lastSnapshotId = await readLastSnapshotId();
  const snapshotId = explicitSnapshotId ?? lastSnapshotId;

  if (snapshotId) {
    try {
      console.log(`Trying snapshot ${snapshotId}`);
      await resumeFromSnapshot(snapshotId);
      return;
    } catch (error) {
      if (noFallback) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.log(`- Snapshot resume failed, falling back to full create: ${message}`);
    }
  }

  await createSandbox();
}

async function resumeLastSnapshot() {
  const snapshotId = await readLastSnapshotId();
  if (!snapshotId) {
    throw new Error("No saved snapshot id found. Run create once first.");
  }

  await resumeFromSnapshot(snapshotId);
}

async function upManySandboxes() {
  const count = parseCount();
  const explicitSnapshotId = getFlag("--snapshot-id");
  const lastSnapshotId = await readLastSnapshotId();
  const snapshotId = explicitSnapshotId ?? lastSnapshotId;

  if (!snapshotId) {
    throw new Error("Missing snapshot id. Run create once or pass --snapshot-id.");
  }

  console.log(`Starting ${count} sandbox(es) from snapshot ${snapshotId}`);

  const launches = Array.from({ length: count }, async (_, index) => {
    const sandbox = await Sandbox.create(snapshotId, {
      timeoutMs: SANDBOX_TIMEOUT_MS,
      metadata: { project: "doodle", purpose: `app-sandbox-${index + 1}` },
    });

    await pullProjectFromGit(sandbox);
    await startServices(sandbox, { waitForHealth: !hasFlag("--no-wait") });

    return {
      index: index + 1,
      sandbox,
      appUrl: `https://${sandbox.getHost(APP_PORT)}`,
      opencodeUrl: `https://${sandbox.getHost(OPENCODE_PORT)}`,
    };
  });

  const results = await Promise.all(launches);

  console.log("\nSandboxes ready");
  for (const item of results) {
    console.log(`- [${item.index}] Sandbox ID: ${item.sandbox.sandboxId}`);
    console.log(`  App URL: ${item.appUrl}`);
    console.log(`  OpenCode Web URL: ${item.opencodeUrl}`);
  }
}

async function triggerOpenCodePrompt(
  sandbox: Sandbox,
  prompt: string,
  index: number,
  opts?: { model?: string; agent?: string },
) {
  const logPath = `${E2B_DIR}/logs/opencode-run-${Date.now()}-${index}.log`;
  const modelArg = opts?.model ? ` --model ${shQuote(opts.model)}` : "";
  const agentArg = opts?.agent ? ` --agent ${shQuote(opts.agent)}` : "";
  const cmd = `bash -lc ${
    shQuote(
      `env MISE_JOBS=1 ${MISE_BIN} x -C ${REMOTE_ROOT} -- opencode run${modelArg}${agentArg} ${
        shQuote(prompt)
      } > ${shQuote(logPath)} 2>&1`,
    )
  }`;

  await sandbox.commands.run(cmd, {
    cwd: REMOTE_ROOT,
    timeoutMs: 5_000,
    background: true,
  });

  return logPath;
}

async function runPromptInSandboxes() {
  const count = parseCount();
  const prompt = getPrompt();
  const model = getFlag("--model");
  const agent = getFlag("--agent");

  const explicitSnapshotId = getFlag("--snapshot-id");
  const lastSnapshotId = await readLastSnapshotId();
  const snapshotId = explicitSnapshotId ?? lastSnapshotId;

  if (!snapshotId) {
    throw new Error("Missing snapshot id. Run create once or pass --snapshot-id.");
  }

  console.log(`Starting ${count} sandbox(es) from snapshot ${snapshotId}`);
  console.log(`Prompt: ${prompt}`);

  const launches = Array.from({ length: count }, async (_, index) => {
    const sandbox = await Sandbox.create(snapshotId, {
      timeoutMs: SANDBOX_TIMEOUT_MS,
      metadata: { project: "doodle", purpose: `prompt-run-${index + 1}` },
    });

    await pullProjectFromGit(sandbox);
    await startServices(sandbox, { waitForHealth: !hasFlag("--no-wait") });
    const logPath = await triggerOpenCodePrompt(sandbox, prompt, index + 1, { model, agent });

    return {
      index: index + 1,
      sandboxId: sandbox.sandboxId,
      appUrl: `https://${sandbox.getHost(APP_PORT)}`,
      opencodeUrl: `https://${sandbox.getHost(OPENCODE_PORT)}`,
      logPath,
    };
  });

  const results = await Promise.all(launches);

  console.log("\nPrompt sandboxes ready");
  for (const item of results) {
    console.log(`- [${item.index}] Sandbox ID: ${item.sandboxId}`);
    console.log(`  App URL: ${item.appUrl}`);
    console.log(`  OpenCode Web URL: ${item.opencodeUrl}`);
    console.log(`  Prompt log: ${item.logPath}`);
  }
}

async function runPrompt() {
  const prompt = getPrompt();
  const model = getFlag("--model");
  const agent = getFlag("--agent");
  const explicitSnapshotId = getFlag("--snapshot-id");
  const recreate = hasFlag("--recreate");
  const waitForHealth = hasFlag("--wait");

  console.log(`Prompt: ${prompt}`);

  let sandbox: Sandbox;

  if (recreate) {
    console.log("Recreate requested: building a fresh sandbox and snapshot");
    const result = await createSandbox({ printResult: false });
    sandbox = result.sandbox;
  } else {
    const snapshotId = explicitSnapshotId ?? await readLastSnapshotId();

    if (snapshotId) {
      try {
        console.log(`Trying snapshot ${snapshotId}`);
        sandbox = await resumeFromSnapshot(snapshotId, {
          printResult: false,
          waitForHealth,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`- Snapshot resume failed, creating a fresh sandbox and snapshot: ${message}`);
        const result = await createSandbox({ printResult: false });
        sandbox = result.sandbox;
      }
    } else {
      console.log("- No saved snapshot id found, creating a fresh sandbox and snapshot");
      const result = await createSandbox({ printResult: false });
      sandbox = result.sandbox;
    }
  }

  const logPath = await withStep(
    "Start OpenCode prompt",
    () => triggerOpenCodePrompt(sandbox, prompt, 1, { model, agent }),
  );

  printResult(sandbox);
  console.log(`- Prompt log: ${logPath}`);
}

async function createSnapshotFromSandbox() {
  assertApiKey();

  const sandboxId = getFlag("--sandbox-id");
  if (!sandboxId) {
    throw new Error("Missing --sandbox-id");
  }

  console.log(`Connecting to sandbox ${sandboxId}`);
  const sandbox = await Sandbox.connect(sandboxId);
  const snapshot = await createSnapshotWithRetry(sandbox);
  await writeLastSnapshotId(snapshot.snapshotId);

  console.log("Snapshot created");
  console.log(`- Sandbox ID: ${sandboxId}`);
  console.log(`- Snapshot ID: ${snapshot.snapshotId}`);
}

async function main() {
  const command = Bun.argv[2] ?? "";

  if (!command || command === "help" || command === "--help") {
    usage();
    return;
  }

  if (command === "create") {
    await createSandbox();
    return;
  }

  if (command === "up") {
    await upSandbox();
    return;
  }

  if (command === "prompt") {
    await runPrompt();
    return;
  }

  if (command === "resume-last") {
    await resumeLastSnapshot();
    return;
  }

  if (command === "up-many") {
    await upManySandboxes();
    return;
  }

  if (command === "run-prompt") {
    await runPromptInSandboxes();
    return;
  }

  if (command === "resume") {
    await resumeFromSnapshot();
    return;
  }

  if (command === "snapshot") {
    await createSnapshotFromSandbox();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
