import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractTechniqueTags, normalizeTag } from "@/lib/technique-index/extract-tags";
import type { CutPlan } from "@/lib/cut-plan/schema";

const sample = JSON.parse(
  readFileSync(join(__dirname, "fixtures/sample-cutplan.json"), "utf-8"),
) as CutPlan;

describe("normalizeTag", () => {
  it("snake_case → kebab-case", () => {
    expect(normalizeTag("push_in")).toBe("push-in");
    expect(normalizeTag("CROSS_DISSOLVE")).toBe("cross-dissolve");
  });

  it("trims + lowercases", () => {
    expect(normalizeTag("  Whip Pan  ")).toBe("whip-pan");
  });

  it("collapses repeated separators", () => {
    expect(normalizeTag("push__in")).toBe("push-in");
    expect(normalizeTag("push - in")).toBe("push-in");
  });

  it("drops 'other' / empty", () => {
    expect(normalizeTag("other")).toBe("");
    expect(normalizeTag("")).toBe("");
  });
});

describe("extractTechniqueTags", () => {
  it("returns deduped tags from sample cutplan", () => {
    const tags = extractTechniqueTags(sample);
    expect(tags.cuts).toEqual([...new Set(tags.cuts)]);
    expect(tags.transitions).toEqual([...new Set(tags.transitions)]);
    expect(tags.cameraMoves).toEqual([...new Set(tags.cameraMoves)]);
  });

  it("collects cameraMoves from camera_move actions", () => {
    const cutPlan: CutPlan = {
      ...sample,
      actions: [
        { kind: "camera_move", at: { sec: 0 }, type: "push_in", durationSec: 1 },
        { kind: "camera_move", at: { sec: 2 }, type: "Pull-Out", durationSec: 1 },
        { kind: "camera_move", at: { sec: 4 }, type: "static", durationSec: 1 },
      ],
    };
    const tags = extractTechniqueTags(cutPlan);
    expect(tags.cameraMoves).toContain("push-in");
    expect(tags.cameraMoves).toContain("pull-out");
    expect(tags.cameraMoves).toContain("static");
  });

  it("collects match-cut from cut actions with matching shotSize", () => {
    const cutPlan: CutPlan = {
      ...sample,
      actions: [
        {
          kind: "cut",
          at: { sec: 1 },
          fromShotSize: "close_up",
          toShotSize: "close_up",
        },
      ],
    };
    const tags = extractTechniqueTags(cutPlan);
    expect(tags.cuts).toContain("match-cut");
  });

  it("collects transition tags", () => {
    const cutPlan: CutPlan = {
      ...sample,
      actions: [
        { kind: "transition", at: { sec: 1 }, type: "whip_pan", durationFrames: 6 },
        { kind: "transition", at: { sec: 3 }, type: "cross_dissolve", durationFrames: 12 },
      ],
    };
    const tags = extractTechniqueTags(cutPlan);
    expect(tags.transitions).toContain("whip-pan");
    expect(tags.transitions).toContain("cross-dissolve");
  });

  it("collects hookFormat from structure dimension", () => {
    const cutPlan: CutPlan = {
      ...sample,
      dimensions: {
        ...sample.dimensions,
        structure: {
          ...sample.dimensions.structure,
          hookFormat: "before_after",
        },
      },
    };
    const tags = extractTechniqueTags(cutPlan);
    expect(tags.hookFormats).toContain("before-after");
  });

  it("skips 'other' / empty values", () => {
    const cutPlan: CutPlan = {
      ...sample,
      actions: [
        { kind: "camera_move", at: { sec: 0 }, type: "other", durationSec: 0 },
        { kind: "camera_move", at: { sec: 1 }, type: "", durationSec: 0 },
      ],
    };
    const tags = extractTechniqueTags(cutPlan);
    expect(tags.cameraMoves).not.toContain("other");
    expect(tags.cameraMoves).not.toContain("");
  });
});
