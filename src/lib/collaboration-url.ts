export function validateCollaborationPath(value?: string): string | undefined {
  if (!value) return undefined;
  // Only an explicit same-origin path may receive an editor capability.
  if (!/^\/[A-Za-z0-9_/-]+$/.test(value) || value.startsWith("//"))
    throw new Error(
      "VITE_COLLAB_PATH must be a root-relative path such as /collab.",
    );
  return value.replace(/\/+$/, "");
}

export function collaborationUrl(
  pageUrl: string,
  configuredPath?: string,
): string {
  const url = new URL(pageUrl);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Collaboration requires an HTTP or HTTPS page.");
  const path = validateCollaborationPath(configuredPath);
  const secure = url.protocol === "https:";
  url.protocol = secure ? "wss:" : "ws:";
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  if (path || secure) {
    url.pathname = path || "/collab";
  } else {
    url.port = "4175";
    url.pathname = "/";
  }
  return url.toString();
}
