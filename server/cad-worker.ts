import { spawn } from "node:child_process";

interface WorkerOptions {
  cwd: string;
  timeoutMs?: number;
  killGraceMs?: number;
  maxOutputBytes?: number;
}

export function startCadWorker(
  executable: string,
  args: string[],
  { cwd, timeoutMs = 180000, killGraceMs = 1000, maxOutputBytes = 1_000_000 }: WorkerOptions,
) {
  const child = spawn(executable, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let closed = false;
  let failure: Error | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = (error: Error) => {
    if (closed || failure) return;
    failure = error;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => {
      if (!closed) child.kill("SIGKILL");
    }, killGraceMs);
  };
  const result = new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0, stderr = "";
    const timeout = setTimeout(() => stop(new Error(
      "The package took too long. Try again or simplify the design.",
    )), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (failure) return;
      bytes += chunk.length;
      if (bytes > maxOutputBytes) stop(new Error("CAD output exceeded its limit."));
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on("error", (error) => { failure ??= error; });
    // 'close' follows process exit and stream closure. Never release queue
    // capacity merely because a termination signal was sent.
    child.once("close", (code) => {
      closed = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(
        "CAD generation failed. " + (stderr ? stderr.slice(-500) : "Please inspect the design and retry."),
      ));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
  return {
    result,
    cancel: () => stop(new Error("Build interrupted. Please start a new package.")),
  };
}
