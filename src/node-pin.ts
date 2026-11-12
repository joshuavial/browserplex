// bp is pinned to Node 24: native deps (better-sqlite3 via camoufox) are built for it, and the
// daemon inherits whichever node started the CLI. Under any other major, re-exec on Node 24.
// Imported first by each entry point; a module that exits here stops the rest loading.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const WANT = 24;

function findNode24(): string | undefined {
  const env = process.env.BROWSERPLEX_NODE;
  if (env && existsSync(env)) return env;
  const dir = join(process.env.NVM_DIR || join(homedir(), ".nvm"), "versions", "node");
  try {
    const v = readdirSync(dir).filter((d) => d.startsWith(`v${WANT}.`)).sort().pop();
    if (v && existsSync(join(dir, v, "bin", "node"))) return join(dir, v, "bin", "node");
  } catch {
    /* no nvm */
  }
  return undefined;
}

if (Number(process.versions.node.split(".")[0]) !== WANT && !process.env.BROWSERPLEX_NODE_PINNED) {
  const node = findNode24();
  if (!node) {
    console.error(`browserplex needs Node ${WANT} (running ${process.version}). Install it (nvm install ${WANT}) or set BROWSERPLEX_NODE.`);
    process.exit(1);
  }
  const r = spawnSync(node, process.argv.slice(1), {
    stdio: "inherit",
    env: { ...process.env, BROWSERPLEX_NODE_PINNED: "1" },
  });
  process.exit(r.status ?? 1);
}
