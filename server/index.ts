import "dotenv/config";
import { createApp, createCollaborationServer } from "./app";
const { app, store } = await createApp();
const collaboration = createCollaborationServer(
  store,
  Number(process.env.COLLAB_PORT || 4175),
);
try {
  await collaboration.listen();
  await app.listen({
    port: Number(process.env.PORT || 4174),
    host: "127.0.0.1",
  });
  console.log(
    "Hardware Studio: http://127.0.0.1:" + String(process.env.PORT || 4174),
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Server could not start.",
  );
  process.exitCode = 1;
}
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await collaboration.destroy();
  await app.close();
}
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
