interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface BrowserTool extends ToolDefinition {
  execute: (input: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
}

interface BrowserModelContext {
  registerTool: (tool: BrowserTool, options: { signal: AbortSignal }) => Promise<void>;
}

/** Optional browser-native adapter. The server remains the authority for every tool. */
export async function connectBrowserAgent(versionId: string, credential: string) {
  const context = typeof document === "undefined" ? undefined
    : (document as Document & { modelContext?: BrowserModelContext }).modelContext;
  if (typeof context?.registerTool !== "function") {
    throw new Error("Native WebMCP is not enabled in this browser. Built-in agents and the external MCP connection are available.");
  }
  const base = "/api/proposed-versions/" + encodeURIComponent(versionId);
  const headers = { Authorization: "Bearer " + credential, "Content-Type": "application/json" };
  const response = await fetch(base + "/tools", { headers });
  if (!response.ok) throw new Error("The browser agent connection could not be authorized.");
  const tools: ToolDefinition[] = await response.json();
  // A registration signal removes every tool in this connection. Execution
  // signals remain independent so disconnecting does not cancel in-flight work.
  const registration = new AbortController();
  try {
    for (const tool of tools) {
      await context.registerTool({
        name: "hardware_" + tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: async (input, options) => {
          const result = await fetch(base + "/tools/" + encodeURIComponent(tool.name), {
            method: "POST", headers, body: JSON.stringify(input), signal: options?.signal,
          });
          const body = await result.json();
          if (!result.ok) throw new Error(body.error || "The operation could not be completed.");
          return { content: [{ type: "text", text: JSON.stringify(body) }] };
        },
      }, { signal: registration.signal });
    }
  } catch (error) {
    registration.abort();
    throw error;
  }
  // AbortController.abort() is idempotent, including after partial rollback.
  return () => registration.abort();
}
