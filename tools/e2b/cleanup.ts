import Sandbox from "e2b";

type SandboxListItem = {
  sandboxId?: string;
  id?: string;
  metadata?: Record<string, string>;
  startedAt?: string | Date;
  state?: string;
  name?: string;
  templateId?: string;
};

type Candidate = {
  sandboxId: string;
  ageHours: number;
  running: boolean;
  template: string;
};

function usage() {
  console.log(`
Usage:
  bun run cleanup.ts [--hours <number>] [--project <name>] [--execute] [--include-running] [--all-projects] [--all] [--any-age]

Examples:
  fnox exec -- bun run cleanup.ts
  fnox exec -- bun run cleanup.ts --hours 24
  fnox exec -- bun run cleanup.ts --hours 24 --execute
  fnox exec -- bun run cleanup.ts --all --execute
  fnox exec -- bun run cleanup.ts --all --any-age --execute

Defaults:
  --hours 24
  --project doodle
  dry-run mode (no deletion) unless --execute is provided

Flags:
  --all            Shortcut for --all-projects + --include-running
  --any-age        Ignore age filtering (include newly created sandboxes)

Notes:
  - Requires E2B_API_KEY (inject via fnox).
  - By default, only sandboxes with metadata project=doodle are considered.
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

function assertApiKey() {
  if (!process.env.E2B_API_KEY) {
    throw new Error("E2B_API_KEY is missing. Run with fnox exec.");
  }
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateLike(value: string | Date | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  return parseDate(value);
}

async function main() {
  if (hasFlag("--help") || hasFlag("help")) {
    usage();
    return;
  }

  assertApiKey();

  const maxAgeHours = Number(getFlag("--hours") ?? "24");
  const project = getFlag("--project") ?? "doodle";
  const execute = hasFlag("--execute");
  const all = hasFlag("--all");
  const anyAge = hasFlag("--any-age");
  const includeRunning = hasFlag("--include-running") || all;
  const allProjects = hasFlag("--all-projects") || all;

  if (!anyAge && (!Number.isFinite(maxAgeHours) || maxAgeHours < 0)) {
    throw new Error("--hours must be >= 0");
  }

  console.log(
    anyAge ? "Scanning sandboxes with any age" : `Scanning sandboxes older than ${maxAgeHours}h`,
  );
  if (!allProjects) {
    console.log(`Project filter: ${project}`);
  }
  console.log(`Mode: ${execute ? "execute" : "dry-run"}`);

  const now = Date.now();
  const candidates: Candidate[] = [];

  const paginator = Sandbox.list() as unknown as {
    nextItems: () => Promise<SandboxListItem[]>;
  };

  while (true) {
    let items: SandboxListItem[];

    try {
      items = await paginator.nextItems();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("No more items to fetch")) {
        break;
      }

      throw error;
    }

    for (const item of items) {
      const sandboxId = item.sandboxId ?? item.id;
      if (!sandboxId) continue;

      const metadata = item.metadata ?? {};
      if (!allProjects && metadata.project !== project) {
        continue;
      }

      const startedAt = parseDateLike(item.startedAt);
      if (!startedAt) {
        continue;
      }

      const ageHours = (now - startedAt.getTime()) / (1000 * 60 * 60);
      if (!anyAge && ageHours < maxAgeHours) {
        continue;
      }

      const running = item.state === "running";
      if (!includeRunning && running) {
        continue;
      }

      candidates.push({
        sandboxId,
        ageHours,
        running,
        template: item.name ?? item.templateId ?? "unknown",
      });
    }
  }

  if (candidates.length === 0) {
    console.log("No unused sandboxes matched.");
    return;
  }

  console.log(`Found ${candidates.length} sandbox(es):`);
  for (const item of candidates) {
    console.log(
      `- ${item.sandboxId} | age=${
        item.ageHours.toFixed(1)
      }h | running=${item.running} | template=${item.template}`,
    );
  }

  if (!execute) {
    console.log("\nDry-run only. Re-run with --execute to kill these sandboxes.");
    return;
  }

  for (const item of candidates) {
    try {
      const sandbox = await Sandbox.connect(item.sandboxId);
      await sandbox.kill();
      console.log(`- Killed ${item.sandboxId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`- Failed to kill ${item.sandboxId}: ${message}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
