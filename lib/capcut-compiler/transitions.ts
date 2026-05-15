/**
 * 编排枚举 → CapCut TransitionMaterial 配置映射表
 *
 * 来源：docs/CAPCUT-TRANSITION-STRUCTURE.md 第 2 节 effect_id 实测映射 +
 *       本机 0514 项目（用户手动放 10 种转场样本）真机回填。effect_id 是
 *       CapCut 服务端稳定资源 ID，数字字符串，跨机器一致。
 *
 * 落地约定（与 Task 8/10 衔接）：
 *   - hard_cut → resolveTransitionConfig 返回 null，Task 10 不创建 material、
 *     不在 segment 的 extra_material_refs 写引用
 *   - 未知 type → 降级 cross_dissolve（叠化）并调用 onUnknown 回调（默认 console.warn）
 *   - is_overlap 必须按映射表逐条配置（**非恒 true**，0514 实测：运镜/模糊/故障
 *     三类是 false，其余 true）。CapCut 渲染层用它驱动视觉重叠，写错可能错位
 *   - default_duration_us 仅为兜底；caller 应优先用 AssemblyClip.incomingTransition
 *     .durationSec 转 μs 写入 TransitionMaterial.duration
 */

/**
 * 编排层（Opus assemblyTimeline）输出的转场类型枚举。
 *
 * Task 14：union 定义已上移到 `lib/transitions-labels.client.ts` —— 客户端
 * UI label map 和服务端 catalog 引同一源，`Record<AssemblyTransitionType, ...>`
 * 守住编译期同步。此处 re-export 保持既有 `import { AssemblyTransitionType }
 * from "@/lib/capcut-compiler/transitions"` 调用方零破坏。
 *
 * Opus 可能自由发挥输出其它字符串 —— resolveTransitionConfig 走 fallback。
 */
export type { AssemblyTransitionType } from "@/lib/transitions-labels.client";

/**
 * 单种转场对应的 CapCut 资源配置。
 * 0514 真机数据回填了 cross_dissolve / match_cut 的 category_id（之前留空/错值），
 * 并新增 8 条 0514 实测的转场类别。
 */
export type CapCutTransitionConfig = {
  /** CapCut 服务端资源 ID，数字字符串 */
  effect_id: string;
  /** = effect_id，schema 字段冗余 */
  resource_id: string;
  /** 人类可读名，调试用 */
  name: string;
  /** CapCut 分类 ID（0514 真机回填） */
  category_id: string;
  /** CapCut 分类名 */
  category_name: string;
  /** 是否做视觉重叠（按转场类型固有，非恒 true） */
  is_overlap: boolean;
  /** 默认时长（μs），caller 应优先用编排层的 durationSec */
  default_duration_us: number;
};

// ============ 实测配置 ============
// 0514 项目位置：CapCut/User Data/Projects/com.lveditor.draft/0514/draft_content.json
// 该项目用户手动给 11 个连续 video segment 各加 1 种转场，转场 type 全覆盖
// （含叠化、流行切换、推近、缩放轮播、模糊、替换、Wispy Fade、翻转视角、色差故障、幻影波动）。

const CROSS_DISSOLVE_CONFIG: CapCutTransitionConfig = {
  effect_id: "6724845717472416269",
  resource_id: "6724845717472416269",
  name: "叠化",
  // 0514 真机：27188（之前 catalog 错写 27186）
  category_id: "27188",
  category_name: "叠化转场",
  is_overlap: true,
  default_duration_us: 466666,
};

const WHIP_PAN_CONFIG: CapCutTransitionConfig = {
  // Task 2 PROBE 落地的 Slick Twist；0514 用户没加这一个但 plan v4.1-review 签字保留。
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
  // 0514 真机回填：27190（之前 catalog 留空，注释为"等 Task 12 真机回填"）
  category_id: "27190",
  category_name: "基础转场",
  is_overlap: true,
  default_duration_us: 1866666,
};

// ===== 0514 新增 8 条 =====

const FLASH_CONFIG: CapCutTransitionConfig = {
  effect_id: "7574646707154275589",
  resource_id: "7574646707154275589",
  name: "流行切换",
  category_id: "27191",
  category_name: "Light",
  is_overlap: true,
  default_duration_us: 2000000,
};

const PUSH_IN_TRANSITION_CONFIG: CapCutTransitionConfig = {
  effect_id: "6724226861666144779",
  resource_id: "6724226861666144779",
  name: "推近",
  category_id: "27187",
  category_name: "运镜",
  // 0514 实测：运镜类是 false
  is_overlap: false,
  default_duration_us: 466666,
};

const BLUR_CONFIG: CapCutTransitionConfig = {
  effect_id: "6916426617455645186",
  resource_id: "6916426617455645186",
  name: "转场-模糊",
  category_id: "27189",
  category_name: "模糊",
  // 0514 实测：模糊类是 false
  is_overlap: false,
  default_duration_us: 466666,
};

const ZOOM_CAROUSEL_CONFIG: CapCutTransitionConfig = {
  effect_id: "7502402658632879413",
  resource_id: "7502402658632879413",
  name: "缩放轮播",
  // 0514 实测：3D 类的 category_id 是 10 位数字（不是 5 位）
  category_id: "2037710483",
  category_name: "3D",
  is_overlap: true,
  default_duration_us: 2000000,
};

const WISPY_FADE_CONFIG: CapCutTransitionConfig = {
  effect_id: "7607215892333890821",
  resource_id: "7607215892333890821",
  name: "Wispy Fade",
  category_id: "27197",
  category_name: "遮罩转场",
  is_overlap: true,
  default_duration_us: 2000000,
};

const FLIP_CONFIG: CapCutTransitionConfig = {
  effect_id: "7507477574705073461",
  resource_id: "7507477574705073461",
  name: "翻转视角",
  category_id: "27194",
  category_name: "幻灯片",
  is_overlap: true,
  default_duration_us: 2000000,
};

const GLITCH_CONFIG: CapCutTransitionConfig = {
  effect_id: "6724239785205961228",
  resource_id: "6724239785205961228",
  name: "色差故障",
  category_id: "27192",
  category_name: "故障",
  // 0514 实测：故障类是 false
  is_overlap: false,
  default_duration_us: 200000,
};

const DISTORT_CONFIG: CapCutTransitionConfig = {
  effect_id: "7233996535921381890",
  resource_id: "7233996535921381890",
  name: "幻影波动",
  category_id: "27193",
  category_name: "扭曲",
  is_overlap: true,
  default_duration_us: 200000,
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
    case "flash":
      return FLASH_CONFIG;
    case "push_in_transition":
      return PUSH_IN_TRANSITION_CONFIG;
    case "blur":
      return BLUR_CONFIG;
    case "zoom_carousel":
      return ZOOM_CAROUSEL_CONFIG;
    case "wispy_fade":
      return WISPY_FADE_CONFIG;
    case "flip":
      return FLIP_CONFIG;
    case "glitch":
      return GLITCH_CONFIG;
    case "distort":
      return DISTORT_CONFIG;
    default:
      onUnknown(type);
      return FALLBACK_CONFIG;
  }
}
