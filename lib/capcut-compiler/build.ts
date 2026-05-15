import { randomUUID } from "crypto";
import { secToMicroseconds } from "@/lib/cut-plan/time-code";
import {
  TOKEN_PROJECT_DIR,
  TOKEN_DRAFTS_DIR,
} from "@/lib/capcut-compiler/setup-scripts/tokens";
import type { DraftMaterialEntry } from "./schema";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";
import type { TechniqueMatchingResult } from "@/lib/technique-matching/types";
import type { VideoMeta } from "@/lib/video/ffprobe-meta";
import {
  extractTrimRanges,
  computeKeepRanges,
  planEditSegments,
  planFromAssemblyTimeline,
  pickAnimation,
  makeEasedScaleKeyframes,
  clampTransitionDurationSec,
  type EditSegmentPlan,
} from "./edit-plan";
import { resolveTransitionConfig } from "./transitions";
import type {
  AudioMaterial,
  AudioSegment,
  AudioTrack,
  CanvasMaterial,
  CommonKeyframe,
  DraftContent,
  DraftMetaInfo,
  PlaceholderMaterial,
  SegmentClip,
  SoundChannelMaterial,
  SpeedMaterial,
  TextMaterial,
  TextSegment,
  TextTrack,
  TransitionMaterial,
  VideoMaterial,
  VideoSegment,
  VideoTrack,
  VocalSeparationMaterial,
} from "./schema";

/**
 * CutPlan + MaterialPotential + match result → CapCut DraftContent
 *
 * Phase 5 MVP 范围：
 *   ✓ 主视频轨（按用户原素材，按 topPriorityActions 切镜点拆段）
 *   ✓ 抽出的音频轨（独立 audio 轨道，方便用户后期调整）
 *   ✓ 字幕轨（用户原字幕 + topPriorityActions 中 metaphor hooks 推荐的字幕）
 *   ✓ push-in / pull-out 缩放动画（用 common_keyframes 实现）
 *   ✗ Phase 5+: whip pan / match cut / 复杂转场 / 调色 / 特效
 */

const ZERO_CLIP: SegmentClip = {
  alpha: 1,
  rotation: 0,
  scale: { x: 1, y: 1 },
  transform: { x: 0, y: 0 },
  flip: { horizontal: false, vertical: false },
};

function id(): string {
  // CapCut 用全大写带连字符 UUID
  return randomUUID().toUpperCase();
}

function nowFiletime(): number {
  // Windows FILETIME: 100-nanosecond intervals since 1601-01-01
  const unixMs = Date.now();
  const filetimeOffset = 11644473600000; // ms between 1601 and 1970
  return (unixMs + filetimeOffset) * 10000;
}

function nowMs(): number {
  return Date.now();
}

export type CompileInput = {
  projectName: string;
  /**
   * N 个用户视频在 CapCut 项目中的相对路径（解压后 CapCut 看到的位置）。
   * 与 `metas` 同长度且按上传全集顺序对齐。Task 9 起 build 接入多 material。
   */
  videoFileNames: ReadonlyArray<string>;
  /** 用户上传的 BGM 文件名（Phase 5.5）。不传则视频自带音轨负责播放，不创建独立 audio 轨 */
  bgmFileName?: string;
  /** BGM 时长（秒，从 ffprobe 拿）。bgmFileName 存在时必填 */
  bgmDurationSec?: number;
  /** 与 `videoFileNames` 同序、同长度的 ffprobe 元数据数组。 */
  metas: ReadonlyArray<VideoMeta>;
  potential: MaterialPotential;
  match: TechniqueMatchingResult;
};

/**
 * 视频文件名最大长度（含扩展名）。sanitizeVideoFileName 与 dedupeFileNames
 * 共用此上限 —— 任何调整必须在两处同步生效，所以集中定义。
 */
export const MAX_VIDEO_FILE_NAME_LEN = 120;

/**
 * 把用户上传的视频文件名清洗成可安全放进 zip / draft JSON 路径的文件名。
 * 保留原始可识别性（消除"手动 link 文件名不匹配"那条根因），只替换会破坏
 * 文件系统 / JSON 路径的字符。缺失或异常时退化为 "input.mp4"。
 */
export function sanitizeVideoFileName(raw: string | undefined): string {
  const FALLBACK = "input.mp4";
  if (!raw) return FALLBACK;
  // 取 basename：去掉任何 / 或 \ 前缀
  const base = raw.split(/[\\/]/).pop()?.trim() ?? "";
  if (!base) return FALLBACK;
  // 占位 token 出现在文件名里 → 直接退化，避免脏了字面替换
  if (base.includes("__VR_")) return FALLBACK;
  // 替换文件系统非法字符 + 控制字符
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") return FALLBACK;
  // 限长，保留扩展名
  if (cleaned.length > MAX_VIDEO_FILE_NAME_LEN) {
    const dot = cleaned.lastIndexOf(".");
    if (dot > 0) {
      const ext = cleaned.slice(dot);
      return cleaned.slice(0, MAX_VIDEO_FILE_NAME_LEN - ext.length) + ext;
    }
    return cleaned.slice(0, MAX_VIDEO_FILE_NAME_LEN);
  }
  return cleaned;
}

/**
 * 多视频上传时，把已 sanitize 的文件名数组去重。重名按出现顺序加 `-1`/`-2`
 * 后缀（保扩展名）。
 *
 * 关键不变量：`draft_content.json` 的 `materials.videos[i].path`、
 * `draft_meta_info.json` 的 `draft_materials[0].value[i].file_Path`、
 * 以及 zip 内 `materials/<name>` 三处必须用同一份数组，才能让 CapCut 解析。
 * 调用方应在 sanitize 之后立刻 dedupe，再 forward 给 build/package。
 *
 * 长度仍受 {@link sanitizeVideoFileName} 的 120 字符上限约束 —— 后缀拼上来
 * 后再次截 stem 部分以保扩展名。
 */
export function dedupeFileNames(
  names: ReadonlyArray<string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    if (!seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
      continue;
    }
    const dot = raw.lastIndexOf(".");
    const stem = dot > 0 ? raw.slice(0, dot) : raw;
    const ext = dot > 0 ? raw.slice(dot) : "";
    let n = 1;
    let candidate = makeSuffixed(stem, ext, n);
    while (seen.has(candidate)) {
      n++;
      candidate = makeSuffixed(stem, ext, n);
    }
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

function makeSuffixed(stem: string, ext: string, n: number): string {
  const suffix = `-${n}`;
  const joined = `${stem}${suffix}${ext}`;
  if (joined.length <= MAX_VIDEO_FILE_NAME_LEN) return joined;
  // stem 截到能容下 suffix + ext
  const room = MAX_VIDEO_FILE_NAME_LEN - suffix.length - ext.length;
  if (room <= 0) {
    // 极端：ext 已经吃满 120，退化到纯 suffix（不再保 ext，但仍唯一）
    return `${suffix.slice(1)}${ext}`.slice(0, MAX_VIDEO_FILE_NAME_LEN);
  }
  return `${stem.slice(0, room)}${suffix}${ext}`;
}

/**
 * 兼容路径（无 assemblyTimeline）：按主视频（metas[0]）走 trim/keep + 切点切段。
 * 输出的每个 plan 的 sourceVideoIndex 默认为 0（planEditSegments 行为）。
 */
function buildEditPlan(
  match: TechniqueMatchingResult,
  potential: MaterialPotential,
  totalDurSec: number,
): EditSegmentPlan[] {
  const trims = extractTrimRanges(match, totalDurSec);
  const keepRanges = computeKeepRanges(totalDurSec, trims);

  const cutSet = new Set<number>();
  for (const a of match.topPriorityActions ?? []) {
    if (a.userVideoAt && typeof a.userVideoAt.sec === "number") {
      cutSet.add(a.userVideoAt.sec);
    }
  }
  for (const action of potential.base.actions) {
    if (action.kind === "cut" && typeof action.at.sec === "number") {
      cutSet.add(action.at.sec);
    }
  }
  const cutPoints = Array.from(cutSet).sort((a, b) => a - b);

  return planEditSegments(keepRanges, cutPoints, (sStart, sEnd, idx) =>
    pickAnimation(sStart, sEnd, idx, potential, match),
  );
}

/**
 * cover-fit scale：让 segment 视频铺满 canvas（保持纵横比，多出部分裁掉）。
 * 等尺寸短路返回 1，避免引入浮点扰动。
 */
function computeFitScale(
  canvasW: number,
  canvasH: number,
  segW: number,
  segH: number,
): number {
  if (segW === canvasW && segH === canvasH) return 1;
  if (segW <= 0 || segH <= 0) return 1;
  return Math.max(canvasW / segW, canvasH / segH);
}

/**
 * 抽字幕：仅保留用户原视频已有的字幕。
 * match 里的 technique.name 是"技法建议"不是"字幕文本"，不能直接当字幕。
 * Phase 5+ 可以从 metaphorHooks.bgmLyricFragment 提取实际可用的歌词字幕。
 */
function extractSubtitles(potential: MaterialPotential) {
  type Sub = { atSec: number; durationSec: number; text: string };
  const subs: Sub[] = [];

  for (const action of potential.base.actions) {
    if (action.kind === "subtitle" && action.text.trim()) {
      subs.push({
        atSec: action.at.sec,
        durationSec: action.durationSec ?? 2,
        text: action.text.trim(),
      });
    }
  }

  subs.sort((a, b) => a.atSec - b.atSec);
  return subs;
}

export function buildDraftContent(input: CompileInput): {
  draftContent: DraftContent;
  metaInfo: DraftMetaInfo;
} {
  if (input.metas.length === 0 || input.videoFileNames.length === 0) {
    throw new Error("buildDraftContent: metas/videoFileNames must be non-empty");
  }
  if (input.metas.length !== input.videoFileNames.length) {
    throw new Error(
      `buildDraftContent: metas (${input.metas.length}) and videoFileNames (${input.videoFileNames.length}) length mismatch`,
    );
  }

  const projectId = id();
  const primaryMeta = input.metas[0];
  const durationUs = secToMicroseconds(primaryMeta.durationSec);
  const isPortrait = primaryMeta.height > primaryMeta.width;
  const ratio =
    isPortrait &&
    Math.abs(primaryMeta.width / primaryMeta.height - 9 / 16) < 0.05
      ? "9:16"
      : !isPortrait &&
          Math.abs(primaryMeta.width / primaryMeta.height - 16 / 9) < 0.05
        ? "16:9"
        : "original";

  // ===== Materials =====

  // path 用占位 token：server 端写不出用户机器的绝对路径，所以写
  // `${TOKEN_PROJECT_DIR}/materials/<file>`，zip 附的 setup 脚本在用户机器上
  // 把 token 字面替换成项目文件夹的绝对路径。CapCut 要的就是绝对路径
  // （原生项目 0203/0205 验证）。
  const videoMaterials: VideoMaterial[] = input.metas.map((m, i) => ({
    id: id(),
    type: "video",
    path: `${TOKEN_PROJECT_DIR}/materials/${input.videoFileNames[i]}`,
    material_name: input.videoFileNames[i],
    width: m.width,
    height: m.height,
    duration: secToMicroseconds(m.durationSec),
    has_audio: m.hasAudio,
  }));

  // 视频自带音轨已经在 video segment 里播放（speed=1, volume=1）。
  // 只有用户主动上传 BGM 时才创建独立 audio 轨（Phase 5.5）。
  //
  // BGM path 同样用占位 token。
  const bgmMaterial: AudioMaterial | null = input.bgmFileName
    ? {
        id: id(),
        type: "music",
        path: `${TOKEN_PROJECT_DIR}/materials/${input.bgmFileName}`,
        name: input.bgmFileName,
        duration: secToMicroseconds(
          Math.min(
            input.bgmDurationSec ?? primaryMeta.durationSec,
            primaryMeta.durationSec,
          ),
        ),
      }
    : null;

  // ===== Edit plan: trim + keep + segment placement =====
  // Task 9：match.assemblyTimeline 存在 → multi-video 编排路径；
  //          否则 → 旧 buildEditPlan 兼容路径（sourceVideoIndex 一律 0）。

  const editPlan: EditSegmentPlan[] = input.match.assemblyTimeline
    ? planFromAssemblyTimeline(input.match.assemblyTimeline, input.metas)
    : buildEditPlan(input.match, input.potential, primaryMeta.durationSec);

  // 输出总时长 = 最后一段 target_end（剪辑后的紧凑时长，比源视频短）
  const outputDurationUs =
    editPlan.length > 0
      ? secToMicroseconds(editPlan[editPlan.length - 1].targetEndSec)
      : durationUs;

  // ===== Companion materials per video segment =====

  const speeds: SpeedMaterial[] = [];
  const canvases: CanvasMaterial[] = [];
  const soundMappings: SoundChannelMaterial[] = [];
  const placeholders: PlaceholderMaterial[] = [];
  const vocalSeparations: VocalSeparationMaterial[] = [];

  // ===== Video track segments =====

  const videoSegments: VideoSegment[] = editPlan.map((p) => {
    // sourceVideoIndex 在 plan 阶段已 clamp 到 [0, metas.length-1]；
    // 这里再防御一次：越界则回退 0（避免下游 crash，与 review I3 一致）。
    const segIdx =
      p.sourceVideoIndex >= 0 && p.sourceVideoIndex < videoMaterials.length
        ? p.sourceVideoIndex
        : 0;
    const segMeta = input.metas[segIdx];
    const segMaterial = videoMaterials[segIdx];
    const fitScale = computeFitScale(
      primaryMeta.width,
      primaryMeta.height,
      segMeta.width,
      segMeta.height,
    );

    const speedMat: SpeedMaterial = {
      id: id(),
      type: "speed",
      speed: 1,
      mode: 0,
    };
    speeds.push(speedMat);

    const canvasMat: CanvasMaterial = {
      id: id(),
      type: "canvas_color",
      color: "",
      image: "",
    };
    canvases.push(canvasMat);

    const soundMat: SoundChannelMaterial = {
      id: id(),
      type: "none",
      audio_channel_mapping: 0,
      is_config_open: false,
    };
    soundMappings.push(soundMat);

    const placeholderMat: PlaceholderMaterial = {
      id: id(),
      type: "placeholder_info",
      error_path: "",
      error_text: "",
      meta_type: "none",
    };
    placeholders.push(placeholderMat);

    const vocalMat: VocalSeparationMaterial = {
      id: id(),
      type: "vocal_separation",
      choice: 0,
      production_path: "",
      removed_sounds: [],
      time_range: { duration: 0, start: 0 },
    };
    vocalSeparations.push(vocalMat);

    const sourceStartUs = secToMicroseconds(p.sourceStartSec);
    const sourceDurUs =
      secToMicroseconds(p.sourceEndSec) - secToMicroseconds(p.sourceStartSec);
    const targetStartUs = secToMicroseconds(p.targetStartSec);
    const targetDurUs =
      secToMicroseconds(p.targetEndSec) - secToMicroseconds(p.targetStartSec);

    // CapCut 要求 4 个 property type 一起设，否则整个动画被忽略。
    // ScaleX 用多 keyframe 模拟 ease-in-out（CapCut keyframe schema 不暴露 easing 字段）。
    // 多视频：素材尺寸 != canvas 时乘 fitScale，让 segment 铺满 canvas（cover）。
    const baseFrom =
      p.animation.type === "none" ? 1.0 : p.animation.scaleFrom;
    const baseTo = p.animation.type === "none" ? 1.0 : p.animation.scaleTo;
    const scaleFrom = baseFrom * fitScale;
    const scaleTo = baseTo * fitScale;
    const scaleKfs = makeEasedScaleKeyframes(scaleFrom, scaleTo, targetDurUs);

    const keyframes: CommonKeyframe[] = [
      {
        property_type: "KFTypeScaleX",
        keyframe_list: scaleKfs,
      },
      {
        property_type: "KFTypePositionX",
        keyframe_list: [
          { time_offset: 0, values: [0] },
          { time_offset: targetDurUs, values: [0] },
        ],
      },
      {
        property_type: "KFTypePositionY",
        keyframe_list: [
          { time_offset: 0, values: [0] },
          { time_offset: targetDurUs, values: [0] },
        ],
      },
      {
        property_type: "KFTypeRotation",
        keyframe_list: [
          { time_offset: 0, values: [0] },
          { time_offset: targetDurUs, values: [0] },
        ],
      },
    ];

    return {
      id: id(),
      material_id: segMaterial.id,
      // 关键：source 是从原视频取片范围，target 是在输出时间轴上的紧贴位置
      // 两者分离 = 真正剪辑（删除 trim 区间 + 重排剩余段）
      target_timerange: { start: targetStartUs, duration: targetDurUs },
      source_timerange: { start: sourceStartUs, duration: sourceDurUs },
      speed: 1,
      volume: 1,
      visible: true,
      // clip.scale 必须跟 keyframe 起始值一致，否则 CapCut 不应用动画
      clip: {
        ...ZERO_CLIP,
        scale: { x: scaleFrom, y: scaleFrom },
      },
      extra_material_refs: [
        speedMat.id,
        canvasMat.id,
        soundMat.id,
        placeholderMat.id,
        vocalMat.id,
      ],
      render_index: 0,
      common_keyframes: keyframes,
    };
  });

  // ===== 真转场（Task 10） =====
  // PROBE 第 3 节：assemblyTimeline.clips[i].incomingTransition → 写进 CapCut
  // segment[i-1] 的 extra_material_refs（前导段挂引用，末段不挂）。
  //
  // 对齐策略：editPlan[i].sourceClipIndex 是该 plan 对应的 clip 下标
  // （planFromAssemblyTimeline 路径才有；degenerate clip 被 skip 时下标会跳号）。
  // 仅在相邻 plan 的 clip 下标连续时挂转场 —— 中间 skip 过 clip 的情况下，转场跨过
  // 不存在的中间段语义不清，丢弃更安全。
  //
  // 兼容路径（无 assemblyTimeline）：editPlan 全无 sourceClipIndex，transitions[] 留空。

  const transitionsList: TransitionMaterial[] = [];
  const clips = input.match.assemblyTimeline?.clips ?? null;

  if (clips !== null) {
    for (let i = 1; i < editPlan.length; i++) {
      const planPrev = editPlan[i - 1]!;
      const planCur = editPlan[i]!;
      const segPrev = videoSegments[i - 1]!;

      const prevClipIdx = planPrev.sourceClipIndex;
      const curClipIdx = planCur.sourceClipIndex;
      if (prevClipIdx === undefined || curClipIdx === undefined) continue;
      // 相邻 plan 的 clip 下标必须连续（中间没 skip）
      if (curClipIdx !== prevClipIdx + 1) continue;

      const clip = clips[curClipIdx];
      const trans = clip?.incomingTransition;
      if (!trans) continue;

      const config = resolveTransitionConfig(trans.type);
      if (config === null) continue; // hard_cut

      const prevDurSec = planPrev.targetEndSec - planPrev.targetStartSec;
      const curDurSec = planCur.targetEndSec - planCur.targetStartSec;
      const clampedDurSec = clampTransitionDurationSec(
        trans.durationSec,
        prevDurSec,
        curDurSec,
      );
      if (clampedDurSec <= 0) continue;

      const transId = id();
      transitionsList.push({
        id: transId,
        type: "transition",
        name: config.name,
        effect_id: config.effect_id,
        resource_id: config.resource_id,
        third_resource_id: "0",
        source_platform: 1,
        path: "",
        duration: Math.round(clampedDurSec * 1_000_000),
        is_overlap: config.is_overlap,
        platform: "all",
        category_id: config.category_id,
        category_name: config.category_name,
        request_id: "",
        is_ai_transition: false,
        video_path: "",
        task_id: "",
      });
      segPrev.extra_material_refs.push(transId);
    }
  }

  const videoTrack: VideoTrack = {
    id: id(),
    type: "video",
    attribute: 0,
    flag: 0,
    segments: videoSegments,
    is_default_name: true,
  };

  // ===== Audio track（只在用户上传 BGM 时创建） =====

  let bgmTrack: AudioTrack | null = null;
  if (bgmMaterial) {
    const audioSpeedMat: SpeedMaterial = {
      id: id(),
      type: "speed",
      speed: 1,
      mode: 0,
    };
    speeds.push(audioSpeedMat);

    const audioSoundMat: SoundChannelMaterial = {
      id: id(),
      type: "none",
      audio_channel_mapping: 0,
      is_config_open: false,
    };
    soundMappings.push(audioSoundMat);

    // BGM 时长可能比视频长，截到视频时长
    // BGM 长度截到剪辑后的输出总时长（不再截到原视频时长，否则结尾会有静音段）
    const bgmDur = Math.min(
      secToMicroseconds(input.bgmDurationSec ?? primaryMeta.durationSec),
      outputDurationUs,
    );

    const bgmSegment: AudioSegment = {
      id: id(),
      material_id: bgmMaterial.id,
      target_timerange: { start: 0, duration: bgmDur },
      source_timerange: { start: 0, duration: bgmDur },
      speed: 1,
      volume: 1,
      visible: true,
      extra_material_refs: [audioSpeedMat.id, audioSoundMat.id],
      render_index: 0,
    };

    bgmTrack = {
      id: id(),
      type: "audio",
      attribute: 0,
      flag: 0,
      segments: [bgmSegment],
      is_default_name: true,
    };
  }

  // ===== Text track =====
  // 字幕段的 target_timerange 必须重映射到剪辑后的输出时间轴：
  //   - 字幕落在被删除的 trim 区间 → 整条丢弃
  //   - 字幕跨过 trim 区间边界 → 截断到 keep 内的部分（简化：直接丢弃跨界的）
  //
  // Task 9 注：assemblyTimeline 路径下 plan.sourceStart/End 不再对应"主视频时间"，
  // 而是按各自 sourceVideoIndex 来；user-supplied subtitle 默认锚定主视频时间，因此
  // 仅命中 sourceVideoIndex===0 的段是安全映射。

  const subtitles = extractSubtitles(input.potential);
  const textMaterials: TextMaterial[] = [];

  const mapSourceToTarget = (srcSec: number): number | null => {
    for (const p of editPlan) {
      if (p.sourceVideoIndex !== 0) continue;
      if (srcSec >= p.sourceStartSec - 1e-3 && srcSec <= p.sourceEndSec + 1e-3) {
        return p.targetStartSec + (srcSec - p.sourceStartSec);
      }
    }
    return null;
  };

  const textSegments: TextSegment[] = [];
  let textIdx = 0;
  for (const sub of subtitles) {
    const targetStartSec = mapSourceToTarget(sub.atSec);
    const targetEndSec = mapSourceToTarget(sub.atSec + sub.durationSec);
    if (targetStartSec === null || targetEndSec === null) continue;
    const effectiveDur = Math.max(0, targetEndSec - targetStartSec);
    if (effectiveDur < 0.1) continue;

    const textMat: TextMaterial = {
      id: id(),
      type: "text",
      content: sub.text,
      font_size: 22,
      color: "#FFFFFF",
      alignment: 1,
    };
    textMaterials.push(textMat);

    const startUs = secToMicroseconds(targetStartSec);
    const durUs = secToMicroseconds(effectiveDur);

    textSegments.push({
      id: id(),
      material_id: textMat.id,
      target_timerange: { start: startUs, duration: durUs },
      source_timerange: { start: 0, duration: durUs },
      visible: true,
      extra_material_refs: [],
      render_index: 1000 + textIdx,
    });
    textIdx++;
  }

  const textTrack: TextTrack | null = textSegments.length > 0
    ? {
        id: id(),
        type: "text",
        attribute: 0,
        flag: 0,
        segments: textSegments,
        is_default_name: true,
      }
    : null;

  // ===== Assemble =====

  const tracks = [
    videoTrack,
    ...(bgmTrack ? [bgmTrack] : []),
    ...(textTrack ? [textTrack] : []),
  ];
  const createTime = nowFiletime();
  const updateTime = createTime;

  const draftContent: DraftContent = {
    id: projectId,
    name: input.projectName,
    // 剪辑后的输出总时长（比源视频短），CapCut 会用它画时间轴长度
    duration: outputDurationUs,
    fps: Math.round(primaryMeta.fps),
    canvas_config: {
      width: primaryMeta.width,
      height: primaryMeta.height,
      ratio,
    },
    tracks,
    materials: {
      videos: videoMaterials,
      audios: bgmMaterial ? [bgmMaterial] : [],
      texts: textMaterials,
      speeds,
      canvases,
      sound_channel_mappings: soundMappings,
      placeholder_infos: placeholders,
      vocal_separations: vocalSeparations,
      material_animations: [],
      audio_fades: [],
      transitions: transitionsList,
      video_effects: [],
    },
    create_time: createTime,
    update_time: updateTime,
    version: 360000,
    // 跟 CapCut 国际版 (cc) 8.5.0 自存项目对齐 (samples: new_version 167.0.0)
    new_version: "167.0.0",
    last_modified_platform: {
      app_id: 359289,
      app_source: "cc",
      app_version: "8.5.0",
      device_id: "00000000-0000-0000-0000-000000000000",
      hard_disk_id: "00000000-0000-0000-0000-000000000000",
      mac_address: "00:00:00:00:00:00",
      os: "windows",
      os_version: "10.0.26100",
    },
  };

  // Setup-Script 方案：draft_materials 复刻原生 0203 项目的七组结构
  // （type 0/1/2/3/6/7/8）。type 0 = 本地导入媒体组，放视频（和 BGM）条目。
  // file_Path 写占位 token，setup 脚本在用户机器上替换成绝对路径。
  // entry.id 必须等于 draft_content 里对应 material 的 id（CapCut 靠它关联）。
  const importedAtMs = Date.now();
  const nowSec = Math.floor(importedAtMs / 1000);
  const nowUs = importedAtMs * 1000;

  const group0Entries: DraftMaterialEntry[] = videoMaterials.map((vm, i) => {
    const meta = input.metas[i];
    const dUs = secToMicroseconds(meta.durationSec);
    return {
      ai_group_type: "",
      create_time: nowSec,
      duration: dUs,
      extra_info: input.videoFileNames[i],
      file_Path: `${TOKEN_PROJECT_DIR}/materials/${input.videoFileNames[i]}`,
      height: meta.height,
      id: vm.id,
      import_time: nowSec,
      import_time_ms: nowUs,
      item_source: 1,
      md5: "",
      metetype: "video",
      roughcut_time_range: { duration: dUs, start: 0 },
      sub_time_range: { duration: -1, start: -1 },
      type: 0,
      width: meta.width,
    };
  });

  if (bgmMaterial && input.bgmFileName) {
    group0Entries.push({
      ai_group_type: "",
      create_time: nowSec,
      duration: bgmMaterial.duration,
      extra_info: input.bgmFileName,
      file_Path: `${TOKEN_PROJECT_DIR}/materials/${input.bgmFileName}`,
      height: 0,
      id: bgmMaterial.id,
      import_time: nowSec,
      import_time_ms: nowUs,
      item_source: 1,
      md5: "",
      metetype: "music",
      roughcut_time_range: { duration: bgmMaterial.duration, start: 0 },
      sub_time_range: { duration: -1, start: -1 },
      type: 0,
      width: 0,
    });
  }

  const tmNow = nowMs();

  const metaInfo: DraftMetaInfo = {
    draft_id: projectId,
    draft_name: input.projectName,
    // setup 脚本会把这两个 token 替换成本机绝对路径
    draft_root_path: TOKEN_DRAFTS_DIR,
    draft_fold_path: TOKEN_PROJECT_DIR,
    draft_removable_storage_device: "",
    draft_timeline_materials_size_: 0,
    draft_materials: [
      { type: 0, value: group0Entries },
      { type: 1, value: [] },
      { type: 2, value: [] },
      { type: 3, value: [] },
      { type: 6, value: [] },
      { type: 7, value: [] },
      { type: 8, value: [] },
    ],
    draft_materials_copied_info: [],
    tm_draft_create: tmNow,
    tm_draft_modified: tmNow,
    tm_duration: outputDurationUs,
    draft_cover: "draft_cover.jpg",
    draft_deleted: false,
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_from_deeplink: "false",
    draft_is_invisible: false,
    draft_new_version: "167.0.0",
    draft_segment_extra_info: [],
    draft_type: "",
  };

  return { draftContent, metaInfo };
}
