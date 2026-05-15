/**
 * 编排转场枚举 + 中文短标签 —— **纯客户端模块**（无 server-only import）。
 *
 * 服务端 catalog（`lib/capcut-compiler/transitions.ts`）和客户端 UI
 * （`components/technique-match/AssemblySummary.tsx`）都引这里的 union，
 * 让 `Record<AssemblyTransitionType, string>` 的 TS 编译期约束守住两边
 * 同步：新增 union case 不加 label 或者 label 多余 key 都会 tsc 报错。
 *
 * 文件名 `.client.ts` 是 Next.js 约定明示"该模块可安全进 client bundle"。
 *
 * 核心 5 个（plan v4.1-review 签字 / Opus prompt 列举）：
 *   cross_dissolve / fade / whip_pan / match_cut / hard_cut
 *
 * 0514 真机扩展 8 个：
 *   flash / push_in_transition / blur / zoom_carousel / wispy_fade / flip / glitch / distort
 */
export type AssemblyTransitionType =
  | "cross_dissolve"
  | "fade"
  | "whip_pan"
  | "match_cut"
  | "hard_cut"
  | "flash"
  | "push_in_transition"
  | "blur"
  | "zoom_carousel"
  | "wispy_fade"
  | "flip"
  | "glitch"
  | "distort";

/**
 * 转场类型 → 中文短标签。`Record<AssemblyTransitionType, string>` 让 TS
 * 编译期强制 union ⇄ key 同步：新增 union case 不补 label → tsc 红；
 * 多余 label key → tsc 红。等价于 exhaustive switch 检查，无需 runtime 测试。
 */
export const TRANSITION_LABEL: Record<AssemblyTransitionType, string> = {
  cross_dissolve: "叠化",
  fade: "叠化",
  whip_pan: "Slick Twist",
  match_cut: "替换",
  hard_cut: "硬切",
  flash: "流行切换",
  push_in_transition: "推近",
  blur: "模糊",
  zoom_carousel: "缩放轮播",
  wispy_fade: "Wispy Fade",
  flip: "翻转视角",
  glitch: "色差故障",
  distort: "幻影波动",
};

/**
 * UI 安全访问 helper：未知 type（Opus 自由发挥的字符串）回退到 type 原文，
 * 避免悄悄掩盖。caller 不需要先校验 `type is AssemblyTransitionType`。
 */
export function transitionLabel(type: string): string {
  return (TRANSITION_LABEL as Record<string, string>)[type] ?? type;
}
