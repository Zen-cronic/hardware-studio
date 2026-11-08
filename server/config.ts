import { isIP } from "node:net";

export function serverConfig(env: Record<string, string | undefined>) {
  const port = (name: string, fallback: number) => {
    const value = env[name] || String(fallback);
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
      throw new Error(`${name} must be an integer from 1 to 65535.`);
    return Number(value);
  };
  const host = (name: string, fallback: string) => {
    const value = env[name] || fallback;
    if (value !== "localhost" && !isIP(value))
      throw new Error(`${name} must be an IP address or localhost.`);
    return value;
  };
  const apiPort = port("PORT", 4174);
  const collabPort = port("COLLAB_PORT", 4175);
  if (apiPort === collabPort)
    throw new Error("PORT and COLLAB_PORT must differ.");
  return {
    port: apiPort,
    host: host("HOST", "127.0.0.1"),
    collabPort,
    collabHost: host("COLLAB_HOST", "127.0.0.1"),
  };
}

export interface AiBudgetPolicy { budgetUsd: number; reservationUsd: number }
export function resourceConfig(env: Record<string, string | undefined>) {
  const integer = (key: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) => {
    const value = env[key] ?? String(fallback);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max)
      throw new Error(`${key} must be an integer from ${min} to ${max}.`);
    return Number(value);
  };
  return { concurrency: integer("HEAVY_WORKER_CONCURRENCY", 1, 1, 16), queueLimit: integer("HEAVY_WORKER_QUEUE_LIMIT", 8, 0, 100), minFreeDiskBytes: integer("MIN_FREE_DISK_BYTES", 0, 0) };
}
export function aiBudgetConfig(env: Record<string, string | undefined>): AiBudgetPolicy {
  const amount = (key: string, fallback: number, positive = false) => {
    const raw = env[key] ?? String(fallback), value = Number(raw);
    if (!/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(value) || value < 0 || (positive && value < 1))
      throw new Error(`${key} must be a ${positive ? "at least one" : "nonnegative"} dollar amount.`);
    return value;
  };
  return { budgetUsd: amount("AI_BUDGET_USD", 50), reservationUsd: amount("AI_REQUEST_RESERVATION_USD", 1, true) };
}

export function aiProviderConfig(env: Record<string, string | undefined>) {
  const raw = env.AI_PROVIDER_CONCURRENCY ?? "2", concurrency = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16)
    throw new Error("AI_PROVIDER_CONCURRENCY must be an integer from 1 to 16.");
  return { concurrency };
}

export interface DesignAdmissionPolicy {
  maxDesigns: number;
  creationsPerWindow: number;
  windowSeconds: number;
}
export function designAdmissionConfig(env: Record<string, string | undefined>): DesignAdmissionPolicy {
  const integer = (key: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) => {
    const raw = env[key] ?? String(fallback), value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`${key} must be an integer from ${min} to ${max}.`);
    return value;
  };
  return {
    maxDesigns: integer("MAX_SAVED_DESIGNS", 0, 0),
    creationsPerWindow: integer("DESIGN_CREATIONS_PER_WINDOW", 0, 0),
    windowSeconds: integer("DESIGN_CREATION_WINDOW_SECONDS", 3600, 1, 604800),
  };
}
