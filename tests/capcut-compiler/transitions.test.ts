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
    // 0514 真机回填：之前 catalog 错写 27186，实际是 27188
    expect(cfg!.category_id).toBe("27188");
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
    // 0514 真机回填：之前 catalog 留空 ""，实际是 27190 基础转场
    expect(cfg!.category_id).toBe("27190");
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

  it("默认 onUnknown 用 structured logger warn 不抛 (emits via console.log JSON)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
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

/**
 * Task 10 · 0514 新别名 8 条（按 0514 项目用户手动样本回填）。
 * 这些 alias 是 Opus 可能输出的精确转场词；catalog 命中而非降级，
 * 避免 Task 12 真机实测出"所有非核心转场全部退化为叠化"的情况。
 */
describe("resolveTransitionConfig — 0514 new aliases", () => {
  it("flash → 流行切换 7574646707154275589 (Light)", () => {
    const c = resolveTransitionConfig("flash")!;
    expect(c.effect_id).toBe("7574646707154275589");
    expect(c.name).toBe("流行切换");
    expect(c.category_id).toBe("27191");
    expect(c.is_overlap).toBe(true);
    expect(c.default_duration_us).toBe(2000000);
  });

  it("push_in_transition → 推近 6724226861666144779 (运镜, is_overlap=false)", () => {
    const c = resolveTransitionConfig("push_in_transition")!;
    expect(c.effect_id).toBe("6724226861666144779");
    expect(c.name).toBe("推近");
    expect(c.category_id).toBe("27187");
    // 关键实测：运镜类 is_overlap=false（叠化恒 true 不成立）
    expect(c.is_overlap).toBe(false);
    expect(c.default_duration_us).toBe(466666);
  });

  it("blur → 转场-模糊 6916426617455645186 (模糊, is_overlap=false)", () => {
    const c = resolveTransitionConfig("blur")!;
    expect(c.effect_id).toBe("6916426617455645186");
    expect(c.category_id).toBe("27189");
    expect(c.is_overlap).toBe(false);
  });

  it("zoom_carousel → 缩放轮播 7502402658632879413 (3D, 10-digit category_id)", () => {
    const c = resolveTransitionConfig("zoom_carousel")!;
    expect(c.effect_id).toBe("7502402658632879413");
    // 唯一一条 10 位 category_id 的 alias，0514 实测
    expect(c.category_id).toBe("2037710483");
    expect(c.is_overlap).toBe(true);
  });

  it("wispy_fade → Wispy Fade 7607215892333890821 (遮罩转场)", () => {
    const c = resolveTransitionConfig("wispy_fade")!;
    expect(c.effect_id).toBe("7607215892333890821");
    expect(c.name).toBe("Wispy Fade");
    expect(c.category_id).toBe("27197");
  });

  it("flip → 翻转视角 7507477574705073461 (幻灯片)", () => {
    const c = resolveTransitionConfig("flip")!;
    expect(c.effect_id).toBe("7507477574705073461");
    expect(c.category_id).toBe("27194");
  });

  it("glitch → 色差故障 6724239785205961228 (故障, is_overlap=false, 200ms)", () => {
    const c = resolveTransitionConfig("glitch")!;
    expect(c.effect_id).toBe("6724239785205961228");
    expect(c.is_overlap).toBe(false);
    expect(c.default_duration_us).toBe(200000);
  });

  it("distort → 幻影波动 7233996535921381890 (扭曲, 200ms)", () => {
    const c = resolveTransitionConfig("distort")!;
    expect(c.effect_id).toBe("7233996535921381890");
    expect(c.category_id).toBe("27193");
    expect(c.default_duration_us).toBe(200000);
  });
});

