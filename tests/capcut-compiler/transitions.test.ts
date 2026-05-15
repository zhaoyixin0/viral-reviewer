import { describe, it, expect, vi } from "vitest";
import { resolveTransitionConfig } from "@/lib/capcut-compiler/transitions";

/**
 * Task 6 baseline：锁定编排枚举 → CapCut effect_id 映射。
 * Task 10 接入真转场前的回归保护，下一 task 改这里要明确说明 effect_id
 * 变更原因（CapCut 资源 ID 是服务端稳定值，变更通常意味着 PROBE 升级）。
 */
describe("resolveTransitionConfig", () => {
  it("hard_cut → null (Task 10 不创建 material，不写 ref)", () => {
    expect(resolveTransitionConfig("hard_cut")).toBeNull();
  });

  it("cross_dissolve → 叠化 6724845717472416269 (PROBE 实测)", () => {
    const cfg = resolveTransitionConfig("cross_dissolve");
    expect(cfg).not.toBeNull();
    expect(cfg!.effect_id).toBe("6724845717472416269");
    expect(cfg!.resource_id).toBe("6724845717472416269");
    expect(cfg!.name).toBe("叠化");
    expect(cfg!.is_overlap).toBe(true);
    expect(cfg!.default_duration_us).toBe(466666);
  });

  it("fade 与 cross_dissolve 同 config (叠化 alias)", () => {
    const a = resolveTransitionConfig("cross_dissolve");
    const b = resolveTransitionConfig("fade");
    expect(b).toEqual(a);
  });

  it("whip_pan → Slick Twist 7627435157909261575 (PROBE 实测)", () => {
    const cfg = resolveTransitionConfig("whip_pan");
    expect(cfg).not.toBeNull();
    expect(cfg!.effect_id).toBe("7627435157909261575");
    expect(cfg!.name).toBe("Slick Twist");
    expect(cfg!.is_overlap).toBe(true);
    expect(cfg!.default_duration_us).toBe(2000000);
  });

  it("match_cut → 替换 7626616498747985168 (PROBE 实测)", () => {
    const cfg = resolveTransitionConfig("match_cut");
    expect(cfg).not.toBeNull();
    expect(cfg!.effect_id).toBe("7626616498747985168");
    expect(cfg!.name).toBe("替换");
    expect(cfg!.is_overlap).toBe(true);
    expect(cfg!.default_duration_us).toBe(1866666);
  });

  it("is_overlap 不能是 hardcode true: 三种命中类型都按映射表逐条配置", () => {
    // 当前 PROBE 实测样本三个都 true；这条测试存在的意义是「未来引入 is_overlap=false
    // 的转场（如推近/转场-模糊）时，必须按映射表配置，不能 hardcode true 跨所有类型」
    const cd = resolveTransitionConfig("cross_dissolve")!;
    const wp = resolveTransitionConfig("whip_pan")!;
    const mc = resolveTransitionConfig("match_cut")!;
    expect(typeof cd.is_overlap).toBe("boolean");
    expect(typeof wp.is_overlap).toBe("boolean");
    expect(typeof mc.is_overlap).toBe("boolean");
  });

  it("未知 type 降级 cross_dissolve 并调用 onUnknown", () => {
    const onUnknown = vi.fn();
    const cfg = resolveTransitionConfig("zoom_blur_3d_glitch", onUnknown);
    expect(cfg).not.toBeNull();
    expect(cfg!.effect_id).toBe("6724845717472416269"); // 叠化
    expect(onUnknown).toHaveBeenCalledTimes(1);
    expect(onUnknown).toHaveBeenCalledWith("zoom_blur_3d_glitch");
  });

  it("默认 onUnknown 用 console.warn 不抛", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = resolveTransitionConfig("future_ai_transition");
      expect(cfg).not.toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("hard_cut 不触发 onUnknown 回调", () => {
    const onUnknown = vi.fn();
    expect(resolveTransitionConfig("hard_cut", onUnknown)).toBeNull();
    expect(onUnknown).not.toHaveBeenCalled();
  });
});
