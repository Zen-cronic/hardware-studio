import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recent, remember, rememberInvitation } from "../src/lib/api";
import { createDesign, deriveDesign } from "../src/shared/engine";
import type { Snapshot } from "../src/shared/types";
let values: Map<string, string>;
let snapshot: Snapshot;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const design = createDesign("holder");
  snapshot = {
    design,
    derived: deriveDesign(design),
    history: [],
    role: "editor",
  };
});
afterEach(() => vi.unstubAllGlobals());
it("recovers editor invitations without weakening access or losing viewer sharing", () => {
  expect(
    remember(snapshot, { editorToken: "editor", viewerToken: "viewer" }),
  ).toBe(true);
  expect(rememberInvitation(snapshot, "editor")).toBe(true);
  expect(recent()).toHaveLength(1);
  expect(recent()[0]).toMatchObject({ token: "editor", viewerToken: "viewer" });
  rememberInvitation({ ...snapshot, role: "viewer" }, "viewer");
  expect(recent()[0]).toMatchObject({ token: "editor", viewerToken: "viewer" });
  values.clear();
  rememberInvitation({ ...snapshot, role: "viewer" }, "viewer");
  rememberInvitation({ ...snapshot, role: undefined }, "unknown");
  expect(recent()).toEqual([]);
});
it("ignores malformed storage and invalid rows while preserving valid designs", () => {
  for (const bad of ["null", "{}", "not json", '[null,4,{"id":"bad"}]']) {
    values.set("hardware-designs", bad);
    expect(recent()).toEqual([]);
    expect(rememberInvitation(snapshot, "editor")).toBe(true);
    expect(recent()).toHaveLength(1);
  }
  const valid = recent()[0];
  values.set(
    "hardware-designs",
    JSON.stringify([
      null,
      valid,
      { ...valid, kind: "bogus" },
      { ...valid, editedAt: "invalid" },
    ]),
  );
  expect(recent()).toEqual([valid]);
});
it("keeps storage denial nonfatal and reports persistence failure", () => {
  vi.stubGlobal("localStorage", {
    getItem() {
      throw Error("denied");
    },
    setItem() {
      throw Error("quota");
    },
  });
  expect(recent()).toEqual([]);
  expect(rememberInvitation(snapshot, "editor")).toBe(false);
  expect(
    remember(snapshot, { editorToken: "editor", viewerToken: "viewer" }),
  ).toBe(false);
});
