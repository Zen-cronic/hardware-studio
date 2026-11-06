import { spawn } from "node:child_process";

interface WorkerOptions {
  cwd: string;
  timeoutMs?: number;
  killGraceMs?: number;
  maxOutputBytes?: number;
  acceptedExitCodes?: number[];
}

export function startCadWorker(
  executable: string,
  args: string[],
  { cwd, timeoutMs = 180000, killGraceMs = 1000, maxOutputBytes = 1_000_000, acceptedExitCodes = [0] }: WorkerOptions,
) {
  // POSIX workers own a process group so native mesher subprocesses receive
  // cancellation too. Windows retains direct-child termination semantics.
  const processGroup = process.platform !== "win32";
  const child = spawn(executable, args, {
    cwd, detached: processGroup, stdio: ["ignore", "pipe", "pipe"],
  });
  let closed = false;
  let failure: Error | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let termination: Promise<void> | undefined;
  const signal = (value: NodeJS.Signals) => {
    if (processGroup && child.pid !== undefined) {
      try { process.kill(-child.pid, value); return; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      }
    }
    child.kill(value);
  };
  const isRunning = () => {
    if (!processGroup || child.pid === undefined) return !closed;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
  };
  const stop = (error: Error) => {
    if (closed || failure) return;
    failure = error;
    signal("SIGTERM");
    termination = new Promise<void>((resolve) => {
      // Do not cancel escalation when only the parent exits: a descendant may
      // ignore TERM and close its inherited streams while continuing to run.
      killTimer = setTimeout(() => signal("SIGKILL"), killGraceMs);
      const check = () => {
        if (isRunning()) setTimeout(check, 10);
        else { clearTimeout(killTimer); resolve(); }
      };
      check();
    });
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
    // 'close' follows parent exit and stream closure. Native descendants with
    // separate stdio may outlive both; retain capacity until the group exits.
    child.once("close", async (code) => {
      closed = true;
      clearTimeout(timeout);
      await termination;
      clearTimeout(killTimer);
      if (failure) reject(failure);
      else if (code === null || !acceptedExitCodes.includes(code)) reject(new Error(
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
