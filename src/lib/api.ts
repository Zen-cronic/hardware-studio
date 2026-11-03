import type { Access, ProductKind, Snapshot, Part } from "../shared/types";
export const uid = () => crypto.randomUUID();
export type Recent = {
  id: string;
  name: string;
  kind: ProductKind;
  token: string;
  viewerToken?: string;
  editedAt: string;
};
function isRecent(value: unknown): value is Recent {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Recent>;
  return (
    typeof row.id === "string" &&
    !!row.id &&
    typeof row.name === "string" &&
    typeof row.token === "string" &&
    !!row.token &&
    [
      "turntable",
      "slider",
      "conveyor",
      "lamp",
      "planter",
      "holder",
      "custom",
    ].includes(row.kind || "") &&
    typeof row.editedAt === "string" &&
    Number.isFinite(Date.parse(row.editedAt)) &&
    (row.viewerToken === undefined || typeof row.viewerToken === "string")
  );
}
export function recent(): Recent[] {
  try {
    const rows: unknown = JSON.parse(
      localStorage.getItem("hardware-designs") || "[]",
    );
    return Array.isArray(rows) ? rows.filter(isRecent).slice(0, 30) : [];
  } catch {
    return [];
  }
}
function saveRecent(
  snapshot: Snapshot,
  token: string,
  viewerToken?: string,
): boolean {
  const rows = recent();
  const previous = rows.find((row) => row.id === snapshot.design.id);
  const item: Recent = {
    id: snapshot.design.id,
    name: snapshot.design.name,
    kind: snapshot.design.kind,
    token,
    viewerToken: viewerToken || previous?.viewerToken,
    editedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(
      "hardware-designs",
      JSON.stringify(
        [item, ...rows.filter((row) => row.id !== item.id)].slice(0, 30),
      ),
    );
    return true;
  } catch {
    return false;
  }
}
export function remember(snapshot: Snapshot, access: Access): boolean {
  return saveRecent(snapshot, access.editorToken, access.viewerToken);
}
// Call only after the server has authenticated this invitation.
export function rememberInvitation(snapshot: Snapshot, token: string): boolean {
  if (snapshot.role !== "editor" || !token) return true;
  return saveRecent(snapshot, token);
}
export function tokenFromUrl() {
  return new URLSearchParams(location.hash.slice(1)).get("token") || "";
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public conflicts: string[] = [],
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  token = "",
  body?: unknown,
): Promise<T> {
  const res = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    let value: { error?: string; conflicts?: string[] } = {};
    try {
      value = await res.json();
    } catch {}
    throw new ApiError(
      value.error || "The request could not be completed. Please try again.",
      res.status,
      value.conflicts,
    );
  }
  return res.json();
}
export async function create(
  kind: ProductKind,
  name?: string,
  customParts?: Part[],
) {
  const result = await api<{ snapshot: Snapshot; access: Access }>(
    "/designs",
    "",
    { kind, name, customParts },
  );
  remember(result.snapshot, result.access);
  return result;
}
export const pathFor = (id: string, token: string) =>
  "/studio/" + id + "#token=" + encodeURIComponent(token);
export function getActor() {
  let name = sessionStorage.getItem("hardware-name");
  if (!name) {
    name = "Maker " + crypto.randomUUID().slice(0, 4);
    sessionStorage.setItem("hardware-name", name);
  }
  return name;
}
export function setActor(name: string) {
  sessionStorage.setItem("hardware-name", name.trim() || "You");
}
