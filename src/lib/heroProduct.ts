import { deskArmParts } from "../shared/desk-arm";
import { DRONE_ARM_IDS, droneParts, withDroneArmThickness } from "../shared/drone";
import type { Part } from "../shared/types";

// The product the home page is built around: the hero model, the walkthrough and "Build it".
// To feature another starter, change these fields in this one place.
export const heroProduct: {
  name: string;
  parts: () => Part[];
  focusPartId: string;
  focusPartName: string;
  changedPartIds: readonly string[];
  changedParts: () => Part[];
} = {
  name: "Camera drone",
  parts: droneParts,
  focusPartId: "arm-front-left",
  focusPartName: "Arm, front left",
  changedPartIds: DRONE_ARM_IDS,
  changedParts: () => withDroneArmThickness(droneParts(), 6),
};

// Pick a starter for a typed or spoken request. Every request starts from a real,
// editable design; the assistant then applies the request in the studio.
export function starterFor(request: string): { name: string; parts: () => Part[] } {
  const text = request.toLowerCase();
  if (/\b(desk arm|camera arm|phone|monitor|stand)\b/.test(text)) return { name: "Articulated camera arm", parts: deskArmParts };
  return { name: heroProduct.name, parts: heroProduct.parts };
}

// The landing hands the first request to the studio through this key.
export const FIRST_REQUEST_KEY = "hs-first-request";
