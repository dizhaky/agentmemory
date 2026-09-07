import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("retired Hermes integration", () => {
  it("is absent from active code, docs, plugins, and website content", () => {
    expect(existsSync("integrations/hermes")).toBe(false);
    expect(existsSync("src/cli/connect/hermes.ts")).toBe(false);

    const grep = spawnSync(
      "git",
      [
        "grep",
        "-Il",
        "hermes",
        "--",
        ".",
        ":!CHANGELOG*",
        ":!docs/system-log/**",
        ":!test/no-retired-hermes.test.ts",
        ":!test/codex-plugin.test.ts",
      ],
      { encoding: "utf8" },
    );
    expect([0, 1]).toContain(grep.status);
    expect(grep.stdout.trim()).toBe("");
  });
});
