import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// Resolution order: AGENTMEMORY_PROJECT_NAME env → git toplevel basename → cwd basename.
export function resolveProject(cwd?: string): string {
  const explicit = process.env["AGENTMEMORY_PROJECT_NAME"];
  if (explicit && explicit.trim()) return explicit.trim();
  const dir = cwd && cwd.trim() ? cwd : process.cwd();
  try {
    let current = realpathSync(dir);
    while (true) {
      if (existsSync(join(current, ".git"))) return basename(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {}
  return basename(dir);
}
