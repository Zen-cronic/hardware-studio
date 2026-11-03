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
