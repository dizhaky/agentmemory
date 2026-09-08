import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

describe("required CI workflow", () => {
  it("runs existing tests on documentation-only changes too", () => {
    expect(workflow).toMatch(/^  pull_request:\n    branches: \[main\]/m);
    expect(workflow).toMatch(/^  push:\n    branches: \[main\]/m);
    expect(workflow).not.toMatch(/^\s+paths(?:-ignore)?:/m);
  });
});
