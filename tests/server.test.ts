import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { createApp, createCollaborationServer } from "../server/app";
import { readSetFor } from "../src/shared/engine";
import { propose } from "../server/proposals";
import type { Snapshot, Command } from "../src/shared/types";
import WebSocket from "ws";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
const dirs: string[] = [];
const stores: Store[] = [];
const dir = () => {
  const x = mkdtempSync(join(tmpdir(), "studio-test-"));
  dirs.push(x);
  return x;
};
const memory = () => {
  const s = new Store(":memory:");
  stores.push(s);
  return s;
};
const cmd = (
  s: Snapshot,
  changes: Record<string, number>,
  actor = "Alex",
): Command => ({
  id: crypto.randomUUID(),
  baseRevision: s.design.revision,
  actor,
  changes,
  readSet: readSetFor(s.design, changes),
});
afterEach(() => {
  stores.forEach((s) => {
    if (s.db.open) s.close();
  });
  stores.length = 0;
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
describe("authoritative revisions", () => {
  it("merges independent concurrent edits and rejects a same-field overwrite", () => {
    const s = memory(),
      { snapshot } = s.create("turntable");
    s.apply(snapshot.design.id, cmd(snapshot, { diameter: 260 }, "Alex"));
    const merged = s.apply(
      snapshot.design.id,
      cmd(snapshot, { rpm: 9 }, "Bea"),
    );
    expect(merged.design.params).toMatchObject({ diameter: 260, rpm: 9 });
    expect(() =>
      s.apply(snapshot.design.id, cmd(snapshot, { diameter: 300 }, "Bea")),
    ).toThrow(/changed/);
    expect(s.get(snapshot.design.id).design.revision).toBe(2);
  });
  it("rejects coupled stale assumptions even if the edited field did not change", () => {
    const s = memory(),
      { snapshot } = s.create("conveyor");
    s.apply(snapshot.design.id, cmd(snapshot, { length: 350 }));
    expect(() =>
      s.apply(snapshot.design.id, cmd(snapshot, { sensorPosition: 280 })),
    ).toThrow(/changed/);
  });
  it("guards an AI proposal with its entire read set", () => {
    const s = memory(),
      { snapshot } = s.create("turntable");
    s.apply(snapshot.design.id, cmd(snapshot, { height: 200 }));
    const ai = {
      ...cmd(snapshot, { diameter: 280 }),
      readSet: { ...snapshot.design.params },
    };
    expect(() => s.apply(snapshot.design.id, ai)).toThrow(/changed/);
  });
  it("retries an operation once and rejects reused identifiers with different content", () => {
    const s = memory(),
      { snapshot } = s.create("turntable"),
      c = cmd(snapshot, { rpm: 12 });
    const first = s.apply(snapshot.design.id, c);
    expect(s.apply(snapshot.design.id, c)).toEqual(first);
    expect(s.get(snapshot.design.id).design.revision).toBe(1);
    expect(() =>
      s.apply(snapshot.design.id, { ...c, changes: { rpm: 11 } }),
    ).toThrow(/identifier/);
  });
  it("undo preserves another person’s independent change", () => {
    const s = memory(),
      { snapshot } = s.create("turntable"),
      c = cmd(snapshot, { diameter: 260 });
    s.apply(snapshot.design.id, c);
    s.apply(snapshot.design.id, cmd(snapshot, { rpm: 11 }, "Bea"));
    const restored = s.undo(
      snapshot.design.id,
      "Alex",
      c.id,
      crypto.randomUUID(),
    );
    expect(restored.design.params.diameter).toBe(220);
    expect(restored.design.params.rpm).toBe(11);
  });
  it("duplicate undo returns the original result without applying a second inverse", () => {
    const s = memory(),
      { snapshot } = s.create("turntable"),
      c = cmd(snapshot, { diameter: 260 });
    s.apply(snapshot.design.id, c);
    const id = crypto.randomUUID();
    const first = s.undo(snapshot.design.id, "Alex", c.id, id);
    expect(s.undo(snapshot.design.id, "Alex", c.id, id)).toEqual(first);
    expect(s.get(snapshot.design.id).design.revision).toBe(2);
    expect(() => s.undo(snapshot.design.id, "Bea", c.id, id)).toThrow(
      /identifier/,
    );
  });
  it("undo refuses later dependent changes and another author", () => {
    const s = memory(),
      { snapshot } = s.create("turntable"),
      c = cmd(snapshot, { diameter: 260 });
    const r = s.apply(snapshot.design.id, c);
    expect(() =>
      s.undo(snapshot.design.id, "Bea", c.id, crypto.randomUUID()),
    ).toThrow(/own/);
    s.apply(snapshot.design.id, cmd(r, { diameter: 280 }, "Bea"));
    expect(() =>
      s.undo(snapshot.design.id, "Alex", c.id, crypto.randomUUID()),
    ).toThrow(/depends/);
  });
  it("invalid edits do not commit partially", () => {
    const s = memory(),
      { snapshot } = s.create("slider");
    expect(() =>
      s.apply(
        snapshot.design.id,
        cmd(snapshot, { travel: 800, cameraWidth: 140 }),
      ),
    ).toThrow();
    expect(s.get(snapshot.design.id).design).toEqual(snapshot.design);
    expect(s.get(snapshot.design.id).history).toEqual([]);
  });
  it("restart restores revisions and capability roles", () => {
    const path = join(dir(), "store.db");
    let s = new Store(path);
    const created = s.create("planter");
    s.apply(created.snapshot.design.id, cmd(created.snapshot, { pots: 5 }));
    s.close();
    s = new Store(path);
    try {
      expect(s.get(created.snapshot.design.id).design.params.pots).toBe(5);
      expect(
        s.role(created.snapshot.design.id, created.access.viewerToken),
      ).toBe("viewer");
      expect(() =>
        s.authorize(
          created.snapshot.design.id,
          created.access.viewerToken,
          true,
        ),
      ).toThrow(/viewing/);
    } finally {
      s.close();
    }
  });
  it("local assistant is explicit and does not invent image measurements", async () => {
    const s = memory(),
      { snapshot } = s.create("turntable");
    const p = await propose(
      s,
      snapshot,
      { prompt: "Set diameter to 270 mm", actor: "Alex" },
      "",
    );
    expect(p.source).toBe("local");
    expect(p.command.changes.diameter).toBe(270);
    const image = await propose(
      s,
      snapshot,
      {
        prompt: "make this fit",
        actor: "Alex",
        image: "data:image/png;base64,AAAA",
      },
      "",
    );
    expect(image.questions?.length).toBeGreaterThan(0);
    expect(image.command.changes).toEqual({});
  });
  it("limits aggregate AI reservations across concurrent requests", () => {
    const s = new Store(":memory:", { budgetUsd: 50, reservationUsd: 1 });
    stores.push(s);
    for (let i = 0; i < 50; i++) s.reserveAi("r" + i);
    expect(() => s.reserveAi("overflow")).toThrow(/limit/);
    s.recordAi("r0", 1000, 100);
    s.recordAi("r1", 1000, 100);
    s.reserveAi("one-more");
    expect(
      (
        s.db
          .prepare("SELECT SUM(spent+reserved) AS total FROM ai_usage")
          .get() as any
      ).total,
    ).toBeLessThanOrEqual(50);
  });
});
describe("HTTP and websocket integration", () => {
  it("enforces permissions, resumes shared design, forks without changing source", async () => {
    const { app } = await createApp({
      dataDir: dir(),
      serveStatic: false,
      aiKey: "",
    });
    try {
      const create = await app.inject({
        method: "POST",
        url: "/api/designs",
        payload: { kind: "turntable" },
      });
      expect(create.statusCode).toBe(201);
      const { snapshot, access } = create.json();
      const url = "/api/designs/" + snapshot.design.id;
      expect((await app.inject(url)).statusCode).toBe(403);
      expect((await app.inject(url + "?token=invalid")).statusCode).toBe(403);
      const denied = await app.inject({
        method: "POST",
        url: url + "/commands?token=" + access.viewerToken,
        payload: cmd(snapshot, { rpm: 8 }),
      });
      expect(denied.statusCode).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: url + "/build?token=" + access.viewerToken,
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
      const edit = await app.inject({
        method: "POST",
        url: url + "/commands",
        headers: { authorization: "Bearer " + access.editorToken },
        payload: cmd(snapshot, { rpm: 8 }),
      });
      expect(edit.json().design.revision).toBe(1);
      const resumed = await app.inject(url + "?token=" + access.viewerToken);
      expect(resumed.json().role).toBe("viewer");
      expect(resumed.json().design.params.rpm).toBe(8);
      const fork = await app.inject({
        method: "POST",
        url: url + "/fork?token=" + access.viewerToken,
        payload: {},
      });
      expect(fork.json().snapshot.design.id).not.toBe(snapshot.design.id);
      expect(fork.json().snapshot.design.params.rpm).toBe(8);
    } finally {
      await app.close();
    }
  });
  it("broadcasts accepted revisions and presence to two sockets", async () => {
    const { app } = await createApp({
      dataDir: dir(),
      serveStatic: false,
      aiKey: "",
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = (app.server.address() as any).port;
    const create = await app.inject({
      method: "POST",
      url: "/api/designs",
      payload: { kind: "holder" },
    });
    const { snapshot, access } = create.json();
    const sockets: WebSocket[] = [];
    const events: any[][] = [[], []];
    try {
      await Promise.all(
        [0, 1].map(
          (i) =>
            new Promise<void>((res, rej) => {
              const ws = new WebSocket(
                "ws://127.0.0.1:" +
                  port +
                  "/api/rooms/" +
                  snapshot.design.id +
                  "?token=" +
                  access.editorToken +
                  "&clientId=p" +
                  i +
                  "&name=Person" +
                  i,
              );
              sockets.push(ws);
              ws.on("error", rej);
              ws.on("message", (raw) => {
                const e = JSON.parse(raw.toString());
                events[i].push(e);
                if (e.type === "presence" && e.peers.length === 2) res();
              });
            }),
        ),
      );
      await app.inject({
        method: "POST",
        url:
          "/api/designs/" +
          snapshot.design.id +
          "/commands?token=" +
          access.editorToken,
        payload: cmd(snapshot, { opening: 100 }),
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(
        events.every((es) =>
          es.some(
            (e) => e.type === "snapshot" && e.snapshot.design.revision === 1,
          ),
        ),
      ).toBe(true);
    } finally {
      sockets.forEach((ws) => ws.close());
      await app.close();
    }
  });
  it("failed CAD package remains tied to the requested revision", async () => {
    const { app } = await createApp({
      dataDir: dir(),
      serveStatic: false,
      python: "/missing/python",
      aiKey: "",
    });
    try {
      const { snapshot, access } = (
        await app.inject({
          method: "POST",
          url: "/api/designs",
          payload: { kind: "lamp" },
        })
      ).json();
      const url = "/api/designs/" + snapshot.design.id;
      const job = (
        await app.inject({
          method: "POST",
          url: url + "/build?token=" + access.editorToken,
          payload: {},
        })
      ).json();
      await app.inject({
        method: "POST",
        url: url + "/commands?token=" + access.editorToken,
        payload: cmd(snapshot, { reach: 350 }),
      });
      const status = (
        await app.inject(
          "/api/builds/" + job.id + "?token=" + access.editorToken,
        )
      ).json();
      expect(status.revision).toBe(0);
      expect(status.status).toBe("failed");
      expect(status.error).toContain("environment");
      expect((await app.inject("/api/builds/" + job.id)).statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});

async function until(check: () => boolean, limit = 4000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > limit)
      throw new Error("Timed out waiting for shared state");
    await new Promise((r) => setTimeout(r, 15));
  }
}
describe("Yjs shared notes", () => {
  it("authenticates capabilities, propagates annotations, blocks viewer writes and persists", async () => {
    const s = memory(),
      created = s.create("turntable");
    const service = createCollaborationServer(s, 0);
    await service.listen();
    expect(service.httpServer.address()).toMatchObject({ address: "127.0.0.1", family: "IPv4" });
    const url = "ws://127.0.0.1:" + service.address.port;
    const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
    const providers: HocuspocusProvider[] = [];
    try {
      for (let i = 0; i < 3; i++)
        providers.push(
          new HocuspocusProvider({
            url,
            name: created.snapshot.design.id,
            token:
              i === 2 ? created.access.viewerToken : created.access.editorToken,
            document: docs[i],
          }),
        );
      await until(() => providers.every((p) => p.isSynced));
      docs[0].getText("notes").insert(0, "Check the hub fit.");
      await until(
        () => docs[1].getText("notes").toString() === "Check the hub fit.",
      );
      expect(providers[2].authorizedScope).toBe("readonly");
      docs[2].getText("notes").insert(0, "UNAUTHORIZED");
      await new Promise((r) => setTimeout(r, 100));
      expect(docs[0].getText("notes").toString()).toBe("Check the hub fit.");
      await until(() =>
        Boolean(
          s.db
            .prepare("SELECT id FROM documents WHERE id=?")
            .get(created.snapshot.design.id),
        ),
      );
      const record = s.db
        .prepare("SELECT content FROM documents WHERE id=?")
        .get(created.snapshot.design.id) as { content: Buffer };
      const restored = new Y.Doc();
      Y.applyUpdate(restored, new Uint8Array(record.content));
      expect(restored.getText("notes").toString()).toBe("Check the hub fit.");
      restored.destroy();
    } finally {
      providers.forEach((p) => p.destroy());
      docs.forEach((d) => d.destroy());
      await service.destroy();
    }
  }, 10000);
});
