import { expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
function start(data: string, env: Record<string, string>) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENAI_API_KEY: "",
        DATA_DIR: data,
        HOST: "127.0.0.1",
        COLLAB_HOST: "127.0.0.1",
        ...env,
      },
      stdio: "pipe",
    },
  );
  let output = "";
  child.stdout.on("data", (b) => {
    output += b;
  });
  child.stderr.on("data", (b) => {
    output += b;
  });
  const exit = new Promise<number | null>((resolve) =>
    child.once("exit", resolve),
  );
  return { child, exit, output: () => output };
}
async function stop(child: ChildProcess, exit: Promise<number | null>) {
  if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.race([
    exit,
    new Promise<void>((resolve) =>
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3000).unref(),
    ),
  ]);
}

it("rejects invalid listener settings before creating a database", async () => {
  const data = await mkdtemp(join(tmpdir(), "studio-invalid-start-"));
  const run = start(data, { PORT: "not-a-port" });
  try {
    expect(await run.exit).toBe(1);
    expect(run.output()).toContain("PORT must be an integer");
    await expect(access(join(data, "studio.sqlite"))).rejects.toThrow();
  } finally {
    await stop(run.child, run.exit);
    await rm(data, { recursive: true, force: true });
  }
}, 15000);

it("starts on explicit ports with isolated persistent data", async () => {
  const data = await mkdtemp(join(tmpdir(), "studio-config-start-"));
  const port = await freePort();
  let collab = await freePort();
  while (collab === port) collab = await freePort();
  const run = start(data, { PORT: String(port), COLLAB_PORT: String(collab) });
  try {
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`http://127.0.0.1:${port}/api/health`)).status;
          } catch {
            return 0;
          }
        },
        { timeout: 10000 },
      )
      .toBe(200);
    const health = await (
      await fetch(`http://127.0.0.1:${port}/api/health`)
    ).json();
    expect(health.ok).toBe(true);
    expect(health.ai).toBe(false);
    await access(join(data, "studio.sqlite"));
    expect(run.output()).toContain(`127.0.0.1:${port}`);
  } finally {
    await stop(run.child, run.exit);
    await rm(data, { recursive: true, force: true });
  }
}, 15000);

it("releases the annotation listener when the API port is occupied", async () => {
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const port = (blocker.address() as { port: number }).port,
    collab = await freePort();
  const data = await mkdtemp(join(tmpdir(), "studio-failed-start-"));
  const run = start(data, { PORT: String(port), COLLAB_PORT: String(collab) });
  try {
    await expect.poll(() => run.child.exitCode, { timeout: 10000 }).toBe(1);
    expect(run.output()).toContain("EADDRINUSE");
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(collab, "127.0.0.1", resolve);
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  } finally {
    await stop(run.child, run.exit);
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    await rm(data, { recursive: true, force: true });
  }
}, 15000);
