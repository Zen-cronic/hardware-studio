import { describe, expect, it } from "vitest";
import { serverConfig } from "../server/config";
import {
  collaborationUrl,
  validateCollaborationPath,
} from "../src/lib/collaboration-url";

describe("listener configuration", () => {
  it("keeps local defaults and allows separate explicit listeners", () => {
    expect(serverConfig({})).toEqual({
      port: 4174,
      host: "127.0.0.1",
      collabPort: 4175,
      collabHost: "127.0.0.1",
    });
    expect(
      serverConfig({
        HOST: "0.0.0.0",
        PORT: "8080",
        COLLAB_HOST: "::1",
        COLLAB_PORT: "8081",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 8080,
      collabHost: "::1",
      collabPort: 8081,
    });
  });
  it("rejects malformed or overlapping listeners before startup", () => {
    for (const key of ["PORT", "COLLAB_PORT"]) {
      for (const value of [
        "0",
        "65536",
        "-1",
        "1.5",
        "12junk",
        "Infinity",
        " ",
      ])
        expect(() => serverConfig({ [key]: value })).toThrow(/integer/);
    }
    for (const key of ["HOST", "COLLAB_HOST"])
      expect(() => serverConfig({ [key]: "https://localhost/path" })).toThrow(
        /IP address/,
      );
    expect(() => serverConfig({ PORT: "4175" })).toThrow(/must differ/);
  });
});

describe("collaboration routing", () => {
  it("preserves local sockets including IPv6 without forwarding page credentials", () => {
    expect(
      collaborationUrl("http://127.0.0.1:4174/studio/a#token=private"),
    ).toBe("ws://127.0.0.1:4175/");
    expect(
      collaborationUrl("http://[::1]:5173/studio/a?x=y#token=private"),
    ).toBe("ws://[::1]:4175/");
  });
  it("uses the HTTPS origin or an explicit same-origin proxy path", () => {
    expect(
      collaborationUrl("https://studio.example/studio/a#token=private"),
    ).toBe("wss://studio.example/collab");
    expect(
      collaborationUrl(
        "https://studio.example:8443/studio/a",
        "/notes/socket/",
      ),
    ).toBe("wss://studio.example:8443/notes/socket");
    expect(collaborationUrl("http://localhost:4180/studio/a", "/collab")).toBe(
      "ws://localhost:4180/collab",
    );
  });
  it("rejects paths that can redirect a capability to another origin", () => {
    for (const value of [
      "//other.example",
      "https://other.example",
      "/\\other.example",
      "/../notes",
      "/notes?token=x",
      "/notes#x",
      "/notes%2f%2fother",
      " ",
    ])
      expect(() => validateCollaborationPath(value)).toThrow(/root-relative/);
    expect(() => collaborationUrl("file:///studio")).toThrow(/HTTP/);
  });
});
