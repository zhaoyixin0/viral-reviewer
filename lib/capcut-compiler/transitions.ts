/**
 * 编排枚举 → CapCut TransitionMaterial 配置映射表
 *
 * 来源：docs/CAPCUT-TRANSITION-STRUCTURE.md 第 2 节 effect_id 实测映射 +
 *       第 5 节 Task 6 落地结论。effect_id 是 CapCut 服务端稳定资源 ID，
 *       数字字符串，跨机器一致。
 *
 * 落地约定（与 Task 8/10 衔接）：
 *   - hard_cut → resolveTransitionConfig 返回 null，Task 10 不创建 material、
 *     不在 segment 的 extra_material_refs 写引用
 *   - 未知 type → 降级 cross_dissolve（叠化）并调用 onUnknown 回调（默认 console.warn）
 *   - is_overlap 必须按映射表逐条配置（**非恒 true**，第 4 节实测修正）。CapCut
 *     渲染层用它驱动视觉重叠，写错可能错位
 *   - default_duration_us 仅为兜底；caller 应优先用 AssemblyClip.incomingTransition
 *     .durationSec 转 μs 写入 TransitionMaterial.duration
 */

/**
 * 编排层（Opus assemblyTimeline）输出的转场类型枚举。
 * Opus 可能自由发挥输出其它字符串 —— resolveTransitionConfig 走 fallback。
 */
export type AssemblyTransitionType =
  | "cross_dissolve"
  | "fade"
  | "whip_pan"
  | "match_cut"
  | "hard_cut";

/**
 * 单种转场对应的 CapCut 资源配置。
 * 从 Task 2 PROBE docs/CAPCUT-TRANSITION-STRUCTURE.md 第 2 节实测表收集。
 */
export type CapCutTransitionConfig = {
  /** CapCut 服务端资源 ID，数字字符串 */
  effect_id: string;
  /** = effect_id，schema 字段冗余 */
  resource_id: string;
  /** 人类可读名，调试用 */
  name: string;
  /** CapCut 分类 ID（部分未实测的转场留空字符串，等 Task 12 真机回填） */
  category_id: string;
  /** CapCut 分类名 */
  category_name: string;
  /** 是否做视觉重叠（按转场类型固有，非恒 true） */
  is_overlap: boolean;
  /** 默认时长（μs），caller 应优先用编排层的 durationSec */
  default_duration_us: number;
};

// ============ 实测配置（docs/CAPCUT-TRANSITION-STRUCTURE.md 第 2 节）============

const CROSS_DISSOLVE_CONFIG: CapCutTransitionConfig = {
  effect_id: "6724845717472416269",
  resource_id: "6724845717472416269",
  name: "叠化",
  category_id: "27186",
  category_name: "叠化转场",
  is_overlap: true,
  default_duration_us: 466666,
};

const WHIP_PAN_CONFIG: CapCutTransitionConfig = {
  effect_id: "7627435157909261575",
  resource_id: "7627435157909261575",
  name: "Slick Twist",
  category_id: "",
  category_name: "Trending",
  is_overlap: true,
  default_duration_us: 2000000,
};

const MATCH_CUT_CONFIG: CapCutTransitionConfig = {
  effect_id: "7626616498747985168",
  resource_id: "7626616498747985168",
  name: "替换",
  category_id: "",
  category_name: "基础转场",
  is_overlap: true,
  default_duration_us: 1866666,
};

const FALLBACK_CONFIG = CROSS_DISSOLVE_CONFIG;

function defaultOnUnknown(type: string): void {
  console.warn(
    `[transitions] unknown transition type "${type}", falling back to cross_dissolve`,
  );
}

/**
 * 把编排层转场枚举映射成 CapCut TransitionMaterial 配置。
 *
 * @param type      编排层 type 字符串。已知值见 AssemblyTransitionType；其它
 *                  字符串（含 Opus 自由发挥）走 fallback（cross_dissolve）
 * @param onUnknown 可选回调，未知 type 时调用。默认 console.warn。Task 10/12 跑批
 *                  时可注入收集器统计降级率
 *
 * @returns null 表示 hard_cut（caller 不应创建 TransitionMaterial / 不写 ref）；
 *          否则返回该转场的 effect_id / is_overlap / default_duration_us 配置
 */
export function resolveTransitionConfig(
  type: string,
  onUnknown: (type: string) => void = defaultOnUnknown,
): CapCutTransitionConfig | null {
  switch (type) {
    case "hard_cut":
      return null;
    case "cross_dissolve":
    case "fade":
      return CROSS_DISSOLVE_CONFIG;
    case "whip_pan":
      return WHIP_PAN_CONFIG;
    case "match_cut":
      return MATCH_CUT_CONFIG;
    default:
      onUnknown(type);
      return FALLBACK_CONFIG;
  }
}
