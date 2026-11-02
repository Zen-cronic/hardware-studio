import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

test("published measurement claims are recomputed from independent fixtures", () => {
  execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/measure.ts"],
    { cwd: process.cwd(), stdio: "pipe" },
  );
  const report = JSON.parse(
    readFileSync(".artifacts/measurement.json", "utf8"),
  );
  const facts = readFileSync("FACTS.md", "utf8");
  const match = facts.match(
    /<!-- measured-claims -->\s*```json\s*([\s\S]*?)\s*```/,
  );
  expect(match, "machine-readable measured claims must exist").not.toBeNull();
  const claims = JSON.parse(match![1]);
  expect(Object.keys(claims)).toEqual([
    "validCases",
    "invalidCasesRejected",
    "customAssemblies",
    "negativeControlDetected",
  ]);
  for (const [key, value] of Object.entries(claims))
    expect(report[key], key).toEqual(value);
}, 15000);
