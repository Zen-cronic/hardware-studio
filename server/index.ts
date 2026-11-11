import "dotenv/config";
import { createApp, createCollaborationServer } from "./app";
import { serverConfig } from "./config";
const config = serverConfig(process.env);
const { app, store, collaboration: sharedCollaboration } = await createApp({ collabTransport: config.collabTransport });
const collaboration = sharedCollaboration ?? createCollaborationServer(
  store,
  config.collabPort,
  config.collabHost,
);
if (!sharedCollaboration) app.addHook("preClose", async () => { await collaboration.destroy(); });
try {
  if (!sharedCollaboration) await collaboration.listen();
  await app.listen({
    port: config.port,
    host: config.host,
  });
  console.log(`MakeAnything listening on ${config.host}:${config.port}`);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Server could not start.",
  );
  // Fastify can fail before preClose is entered, so drain the separate service explicitly.
  await collaboration.destroy();
  await app.close();
  process.exitCode = 1;
}
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
}
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
