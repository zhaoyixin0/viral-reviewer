import type { CutPlan, TimedAction } from "@/lib/cut-plan/schema";
import type { TechniqueTags } from "./types";

export function normalizeTag(raw: string): string {
  if (!raw) return "";
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (t === "other" || t === "unknown" || t === "none") return "";
  return t;
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of arr) {
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function detectCutTags(actions: TimedAction[]): string[] {
  const tags: string[] = [];
  for (const a of actions) {
    if (a.kind !== "cut") continue;
    if (a.fromShotSize && a.toShotSize && a.fromShotSize === a.toShotSize) {
      tags.push("match-cut");
    }
    if (a.fromShotSize && a.toShotSize && a.fromShotSize !== a.toShotSize) {
      const from = a.fromShotSize;
      const to = a.toShotSize;
      if (
        (from === "wide" && to === "close_up") ||
        (from === "close_up" && to === "wide") ||
        (from === "extreme_wide" && to === "extreme_close_up") ||
        (from === "extreme_close_up" && to === "extreme_wide")
      ) {
        tags.push("scale-jump");
      }
    }
  }
  return tags;
}

export function extractTechniqueTags(plan: CutPlan): TechniqueTags {
  const cuts: string[] = detectCutTags(plan.actions);
  const transitions: string[] = [];
  const cameraMoves: string[] = [];
  const speedChanges: string[] = [];
  const effects: string[] = [];
  const subtitleStyles: string[] = [];

  for (const a of plan.actions) {
    if (a.kind === "transition") {
      transitions.push(normalizeTag(a.type));
    } else if (a.kind === "camera_move") {
      cameraMoves.push(normalizeTag(a.type));
    } else if (a.kind === "speed_change") {
      if (a.multiplier === 0) speedChanges.push("freeze");
      else if (a.multiplier > 1) speedChanges.push("ramp-up");
      else if (a.multiplier > 0 && a.multiplier < 1) speedChanges.push("slow-mo");
    } else if (a.kind === "effect") {
      effects.push(normalizeTag(a.type));
    } else if (a.kind === "subtitle") {
      const animation = a.style?.animation;
      if (animation) subtitleStyles.push(normalizeTag(animation));
    }
  }

  const audioSyncAnchors: string[] = [];
  if (plan.bgm?.markers) {
    for (const m of plan.bgm.markers) {
      audioSyncAnchors.push(normalizeTag(m.kind));
    }
  }

  const hookFormats: string[] = [normalizeTag(plan.dimensions.structure.hookFormat)];

  return {
    cuts: dedupe(cuts),
    transitions: dedupe(transitions),
    cameraMoves: dedupe(cameraMoves),
    speedChanges: dedupe(speedChanges),
    effects: dedupe(effects),
    subtitleStyles: dedupe(subtitleStyles),
    audioSyncAnchors: dedupe(audioSyncAnchors),
    hookFormats: dedupe(hookFormats),
  };
}
