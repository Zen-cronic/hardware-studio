import type { Snapshot } from "../shared/types";
import { resolveSelectionSurface, type SelectionRef } from "../shared/selection";
import { partFeatures } from "../shared/surface";

/** Readable binding for a request target; never throws for a stale target. */
export function targetLabel(snapshot: Snapshot, target: SelectionRef | null | undefined): string {
  if (!target) return "";
  try {
    const pointed = resolveSelectionSurface(snapshot, target);
    if (pointed) return pointed.label;
  } catch { return "a surface that has changed"; }
  return target.partIds.map(id => snapshot.derived.parts.find(part => part.id === id)?.name || "a part no longer available").join(", ");
}

/** The utterance keeps an independent copy so later pointer movement cannot retarget it. */
export function freezeTarget(picked: SelectionRef | null): SelectionRef | null {
  return picked ? structuredClone(picked) : null;
}

/** Removes only the pointed surface; the part stays targeted. */
export function withoutSurface(target: SelectionRef): SelectionRef {
  const { surface: _surface, ...rest } = target;
  return rest;
}

/**
 * Keyboard equivalent of pointing: step through the declared features of a
 * single targeted part. Position -1 is the whole part.
 */
export function cycleSurface(snapshot: Snapshot, target: SelectionRef, step: 1 | -1): SelectionRef {
  if (target.partIds.length !== 1) return target;
  const part = snapshot.derived.parts.find(p => p.id === target.partIds[0]);
  if (!part) return target;
  const features = partFeatures(part);
  if (!features.length) return target;
  const current = target.surface ? features.findIndex(entry => entry.feature.id === target.surface!.featureId) : -1;
  const next = ((current + 1 + step) % (features.length + 1) + features.length + 1) % (features.length + 1) - 1;
  return next < 0 ? withoutSurface(target) : { ...target, surface: features[next].target };
}
