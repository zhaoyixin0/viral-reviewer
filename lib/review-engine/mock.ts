import type { ReviewInput, ReviewResult, ViralFormula } from "./types";

/**
 * Demo fallback：当用户没填 ANTHROPIC / OPENAI key 时，返回基于规则 + 共性数据的
 * 模拟评审结果，确保 demo 流程完整可演示。
 *
 * 维度与 system-prompt 保持一致：钩子 / 身份认同 / 节奏 / 算法 / 视觉 / 传播。
 */
export function buildMockReview(
  input: ReviewInput,
  formula: ViralFormula,
): ReviewResult {
  const isVideo = input.type === "video";
  const dominantPlay = formula.playStyles[0]?.name ?? "前后对比";
  const dominantVisual = formula.visualStyles[0]?.name ?? "Cinematic 大片感";

  return {
    verdict: {
      level: "conditional",
      headline: isVideo
        ? `草稿钩子偏弱、身份认同模糊，按现状发出去完播率撑不过 30%。修以下三处可冲击 1M+。`
        : `「${formula.topic}」赛道在红利期，但你的脚本前 3s 没钩子、缺彩蛋，发出去会被算法判定低质。`,
      topRisks: [
        `0-2s 钩子强度不足，前 3s 流失会拖到 70%+`,
        `缺少「身份认同」承载，用户没有发布动机`,
        `结尾彩蛋 / 反差缺位，传播链路断裂`,
      ],
    },
    scores: [
      {
        dimension: "钩子强度",
        score: 2,
        reason: `前 3s 没有视觉反差 / 数字断言 / POV / 悬念字幕中任何一项。同题材头部爆款 1.5s 内已建立悬念。`,
      },
      {
        dimension: "身份认同",
        score: 2,
        reason: `用户看完不知道「我发这条到我的圈子是为了证明什么」。没有身份认同等于没有发布动机。`,
      },
      {
        dimension: "节奏密度",
        score: 3,
        reason: `镜头切换密度需要明确，建议每 1-1.5s 一镜，字幕每 1.5s 切换。BGM 卡点位置未规划。`,
      },
      {
        dimension: "算法友好度",
        score: 3,
        reason: `标签策略未定，标题前 30 字没钩子，没规划 trending sound 触发声音池。`,
      },
      {
        dimension: "视觉质感",
        score: 3,
        reason: `视觉锚点未定。需要锁一种调色 + 一种镜头语言，避免风格切换。`,
      },
      {
        dimension: "传播性",
        score: 2,
        reason: `结尾未预埋彩蛋 / 反差。可模仿性弱，难以触发模仿跟拍。`,
      },
    ],
    viralFormula: formula,
    timeline: [
      {
        range: "0-2s",
        label: "钩子",
        shots: `${dominantVisual} 风格大特写 / 双画面分屏，命中"${dominantPlay}"开场`,
        transition: `硬切 + 镜头甩动`,
        bgm: `${formula.bgmStyle} 的鼓点在第 1 秒精准卡入（用 trending sound）`,
        subtitles: `「你绝对没见过…」或数字断言`,
        tip: `第 1 秒画面必须完成自我介绍。彩蛋伏笔：第 2s 一闪而过的细节。`,
      },
      {
        range: "2-8s",
        label: "建立场景 + 身份",
        shots: `主镜头切到主体行动 + 字幕亮明身份认同`,
        transition: `卡点切换，每 1-1.5s 一镜`,
        bgm: `BGM 主旋律入场`,
        subtitles: `身份认同字幕（≤ 8 字）：「献给想 XX 的人」`,
        tip: `身份认同是发布动机的核心，缺失等于零自来水。`,
      },
      {
        range: "8-18s",
        label: "主体内容",
        shots: `快剪 3-5 个关键步骤 / 对比镜头`,
        transition: `Whip pan 或 Match cut`,
        bgm: `节奏微加速，配合视觉密度`,
        subtitles: `每 1.5s 一句字幕呼应画面`,
        tip: `信息密度靠画面堆叠，不靠台词。彩蛋伏笔 2：植入"参考作品"风格元素。`,
      },
      {
        range: "18-25s",
        label: "反转 / 结果",
        shots: `全景定格 + 慢动作回放反差画面`,
        transition: `Speed ramp（速度斜坡）`,
        bgm: `鼓点落在反差关键帧`,
        subtitles: `结论字幕，留 1-2 个悬念`,
        tip: `必须命中"身份认同"：用户发这条是为了证明 X。`,
      },
      {
        range: "25-30s",
        label: "结尾彩蛋 + CTA",
        shots: `意外 / 夸张 / 极度惊艳的 1 个镜头`,
        transition: `Cut to black 或挑战引导卡`,
        bgm: `BGM hook 最后一记重击`,
        subtitles: `@friend 跟拍 / 「评论你最想看哪种」`,
        tip: `彩蛋是社交话题性的核心，决定从 1M → 10M。`,
      },
    ],
    suggestions: [
      {
        title: `把钩子前置到第 1 秒`,
        issue: `${formula.topic} 头部爆款 1.5s 内已建立悬念，你的脚本要 3-4s 才入题。`,
        impact: `完播率：前 3s 流失会到 70%+，算法直接判定低质，几乎不会推送。`,
        fix: `把"反差 / 数字 / POV"前置到 0-1s，让画面在第 1 帧就完成自我介绍。第 1 秒文案：「你绝对没见过 XX」。`,
        benchmark: `参考爆款公式中的「${formula.hookPattern}」`,
      },
      {
        title: `建立"身份认同"承载点`,
        issue: `用户看完不知道「我发这条到我的圈子是为了证明自己什么」。`,
        impact: `传播：身份认同是发布动机的核心，缺失等于零自来水，只能靠付费投流。`,
        fix: `明确一句话身份认同，在 3 处一致出现：①标题前 30 字 ②开场字幕 ③结尾 cta。例：「献给想增肌的早八党」。`,
        benchmark: `对标 @protein_kitchen 的「高蛋白 vs 普通人」对比叙事，身份认同打在标题。`,
      },
      {
        title: `结尾必须预埋彩蛋 / 反差`,
        issue: `脚本结尾平稳收束，缺少社交话题性。`,
        impact: `传播：彩蛋是二次传播的引爆点，决定从 1M → 10M。没有彩蛋 = 单条天花板 1M。`,
        fix: `在 25-30s 区间设计一个「夸张 / 离谱 / 极度惊艳」的镜头，配 BGM 鼓点重击。`,
        benchmark: `参考 @glamour_jess 卡点变装的最后一帧 freeze frame，截图传播力极强。`,
      },
      {
        title: `用 trending sound 触发声音池`,
        issue: `BGM 选择没有进入 TikTok 声音池规划。原创 BGM 等于放弃二次推送红利。`,
        impact: `算法：声音池 + 挑战赛池能带来 50%~200% 的二次推送，自创 BGM 完全错过。`,
        fix: `在视频右下"使用此声音"前的小箭头查找当前 trending，挑一个跟内容情绪匹配的，前 1s 卡点。`,
        benchmark: `${formula.bgmStyle}`,
      },
      {
        title: `标题前 30 字 + Hashtag 组合策略`,
        issue: `标题策略未定，feed 折叠后只显示前 30 字，浪费首屏曝光。`,
        impact: `算法：feed 列表里前 30 字决定点击率，点击率拉低初始推送。`,
        fix: `公式：钩子 + 身份认同 + emoji。Hashtag 组合 = #fyp + 2 个题材标签 + 1 个长尾人设标签，共 3-5 个最佳。`,
        benchmark: `（基于 TikTok / Reels 通用爆款规律）`,
      },
    ],
    interrogation: [
      {
        category: "钩子机制",
        question: `你的视频第 1 秒钟画面上是什么？为什么用户会停下不划走？`,
      },
      {
        category: "身份认同",
        question: `用户发这条到他的圈子，他在向谁证明什么？这个动机在标题/开场/结尾 3 处都体现了吗？`,
      },
      {
        category: "节奏",
        question: `你的字幕切换间隔是多少秒？BGM 鼓点落在哪几个画面上？`,
      },
      {
        category: "传播性",
        question: `你预埋的彩蛋在第几秒？是什么？模仿者能用同一个 trending sound 跟拍吗？`,
      },
      {
        category: "算法",
        question: `BGM 是 trending sound 吗？标题前 30 字是什么？hashtag 组合是什么？`,
      },
    ],
    actions: [
      {
        what: `重写 0-2s 脚本（把钩子前置）`,
        how: `把题材的反差点 / 数字钩子前置到第 1 秒，配 trending sound 鼓点`,
        why: `前 3s 完播率决定算法是否推送`,
        who: `P0 必改`,
      },
      {
        what: `定义身份认同一句话`,
        how: `在标题前 30 字 / 开场字幕 / 结尾 cta 三处一致出现`,
        why: `没有身份认同 = 没有发布动机 = 零自来水`,
        who: `P0 必改`,
      },
      {
        what: `预埋结尾彩蛋`,
        how: `25-30s 设计一个夸张/离谱/极度惊艳的镜头 + BGM 鼓点重击`,
        why: `彩蛋决定二次传播，决定 1M → 10M`,
        who: `P1 强烈建议`,
      },
      {
        what: `选 trending sound + 锁定视觉风格`,
        how: `挑当前流行 sound + 锁定 ${dominantVisual} 调色`,
        why: `声音池红利 + 视觉一致性是审美门槛硬指标`,
        who: `P1 强烈建议`,
      },
    ],
  };
}
