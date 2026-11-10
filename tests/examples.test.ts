import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { exampleProofPath, registerExampleRoutes } from "../server/examples";

describe("runtime example pointers", () => {
  it("returns the configured same-origin proof path, or null", async () => {
    const path = "/develop/design-id?proof=version-id#token=view-only";
    expect(exampleProofPath({ EXAMPLE_PROOF_PATH: path })).toBe(path);
    expect(exampleProofPath({})).toBeNull();
    for (const bad of ["https://elsewhere.example/x", "//elsewhere.example/x", "develop/x", "/a b", " "]) expect(exampleProofPath({ EXAMPLE_PROOF_PATH: bad })).toBeNull();
    const app = Fastify();
    registerExampleRoutes(app, { EXAMPLE_PROOF_PATH: path });
    const set = await app.inject({ method: "GET", url: "/api/examples" });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual({ proofPath: path });
    const empty = Fastify(); registerExampleRoutes(empty, {});
    expect((await empty.inject({ method: "GET", url: "/api/examples" })).json()).toEqual({ proofPath: null });
  });
});
