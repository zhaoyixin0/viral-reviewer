import { describe, expect, it } from "vitest";
import {
  BgmTrackSchema,
  BgmMarkerSchema,
  CutPlanSchema,
  TransitionActionSchema,
  CameraMoveActionSchema,
  EffectActionSchema,
} from "@/lib/cut-plan/schema";

/**
 * 防回归：Gemini 2.5 Pro 在描述性字段没识别到时常返 null。
 * 历史上已踩过 4 次：shotSize / bgmPattern / bgmSyncTightness / subtitleStyle。
 * 这里把所有 "LLM 自由输出" 字段的 null 兼容性锁死。
 * 详见 memory: llm-schema-looseness.
 */
describe("CutPlan schema - Gemini null tolerance", () => {
  describe("BgmTrack", () => {
    it("accepts null name (silent video / no BGM detected)", () => {
      const result = BgmTrackSchema.safeParse({
        name: null,
        trending: false,
        bpm: null,
        startsAt: null,
        markers: [],
      });
      expect(result.success).toBe(true);
    });

    it("accepts missing name entirely", () => {
      const result = BgmTrackSchema.safeParse({
        trending: false,
        markers: [],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("BgmMarker", () => {
    it("accepts null kind", () => {
      const result = BgmMarkerSchema.safeParse({
        at: { sec: 1.5 },
        kind: null,
        note: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("TimedAction self-narrated types", () => {
    it("TransitionAction accepts null type", () => {
      const result = TransitionActionSchema.safeParse({
        kind: "transition",
        at: { sec: 1.2 },
        type: null,
        durationFrames: 0,
      });
      expect(result.success).toBe(true);
    });

    it("CameraMoveAction accepts null type", () => {
      const result = CameraMoveActionSchema.safeParse({
        kind: "camera_move",
        at: { sec: 1.2 },
        type: null,
        durationSec: 1.0,
      });
      expect(result.success).toBe(true);
    });

    it("EffectAction accepts null type", () => {
      const result = EffectActionSchema.safeParse({
        kind: "effect",
        at: { sec: 1.2 },
        type: null,
        durationSec: 0.5,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Dimension schemas with LLM-free-text fields", () => {
    const baseCutPlan = {
      videoId: "test-vid-1",
      durationSec: 12.5,
      fps: 30,
      videoFormat: "vlog",
      videoFormatConfidence: 0.85,
      actions: [],
      bgm: null,
      dimensions: {
        pacing: {
          shotCount: 5,
          avgShotDurationSec: 2.5,
          cutDensityPerSec: 0.4,
          rhythmProfile: null,
          keyTwistAt: null,
        },
        camera: {
          dominantMovements: ["static"],
          shotSizeDistribution: {},
          transitionPatterns: ["hard_cut"],
        },
        audiovisual: {
          bgmPattern: null,
          bgmSyncTightness: null,
          subtitleStyle: null,
          colorGrade: null,
        },
        structure: {
          hookFormat: null,
          openingShot: null,
          endingShot: null,
          cta: null,
          payoffAt: null,
        },
      },
      density: {
        editing: 50,
        transition: 30,
        effect: 10,
        bgmSync: 0,
        overall: 35,
      },
    };

    it("accepts CutPlan with all LLM-free-text fields null", () => {
      const result = CutPlanSchema.safeParse(baseCutPlan);
      if (!result.success) {
        console.error(JSON.stringify(result.error.issues, null, 2));
      }
      expect(result.success).toBe(true);
    });

    it("accepts CutPlan with bgm = null (silent video)", () => {
      const result = CutPlanSchema.safeParse({ ...baseCutPlan, bgm: null });
      expect(result.success).toBe(true);
    });

    it("accepts CutPlan with bgm.name = null (the production bug we just hit)", () => {
      const result = CutPlanSchema.safeParse({
        ...baseCutPlan,
        bgm: {
          name: null,
          trending: false,
          bpm: null,
          startsAt: null,
          markers: [],
        },
      });
      expect(result.success).toBe(true);
    });
  });
});
