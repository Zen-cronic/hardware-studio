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
export function recent(): Recent[] {
  try {
    return JSON.parse(localStorage.getItem("hardware-designs") || "[]");
  } catch {
    return [];
  }
}
export function remember(snapshot: Snapshot, access: Access) {
  const item = {
    id: snapshot.design.id,
    name: snapshot.design.name,
    kind: snapshot.design.kind,
    token: access.editorToken,
    viewerToken: access.viewerToken,
    editedAt: new Date().toISOString(),
  };
  localStorage.setItem(
    "hardware-designs",
    JSON.stringify(
      [item, ...recent().filter((x) => x.id !== item.id)].slice(0, 30),
    ),
  );
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
