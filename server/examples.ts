import type { FastifyInstance } from "fastify";

// Runtime pointers to seeded examples, set on the host without rebuilding the client.
// EXAMPLE_PROOF_PATH: a same-origin, view-only path to a design's before-and-after proof.
export function exampleProofPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.EXAMPLE_PROOF_PATH?.trim();
  // Only a root-relative path on this site; never another origin or a protocol-relative URL.
  if (!value || value.length > 500 || !value.startsWith("/") || value.startsWith("//") || /[\s\\]/.test(value)) return null;
  return value;
}

export function registerExampleRoutes(app: FastifyInstance, env: NodeJS.ProcessEnv = process.env) {
  app.get("/api/examples", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { proofPath: exampleProofPath(env) };
  });
}
