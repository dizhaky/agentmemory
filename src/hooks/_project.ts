import { execFile } from "node:child_process";
import { basename } from "node:path";

const PROJECT_RESOLVE_TIMEOUT_MS = 3000;

// Resolution order: AGENTMEMORY_PROJECT_NAME env → git toplevel basename → cwd basename.
export async function resolveProject(cwd?: string): Promise<string> {
  const explicit = process.env["AGENTMEMORY_PROJECT_NAME"];
  if (explicit && explicit.trim()) return explicit.trim();
  const dir = cwd && cwd.trim() ? cwd : process.cwd();

  return new Promise((resolve) => {
    execFile(
      "git",
      ["rev-parse", "--show-toplevel"],
      {
        cwd: dir,
        encoding: "utf8",
        maxBuffer: 4096,
        timeout: PROJECT_RESOLVE_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout) => {
        const toplevel = stdout.trim();
        resolve(!error && toplevel ? basename(toplevel) : basename(dir));
      },
    );
  });
}
