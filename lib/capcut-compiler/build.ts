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
  pickAnimation,
  makeEasedScaleKeyframes,
  type EditSegmentPlan,
} from "./edit-plan";
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
  /** 用户视频在 CapCut 项目中的相对路径（解压后 CapCut 看到的位置） */
  videoFileName: string;
  /** 用户上传的 BGM 文件名（Phase 5.5）。不传则视频自带音轨负责播放，不创建独立 audio 轨 */
  bgmFileName?: string;
  /** BGM 时长（秒，从 ffprobe 拿）。bgmFileName 存在时必填 */
  bgmDurationSec?: number;
  meta: VideoMeta;
  potential: MaterialPotential;
  match: TechniqueMatchingResult;
};

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
  if (cleaned.length > 120) {
    const dot = cleaned.lastIndexOf(".");
    if (dot > 0) {
      const ext = cleaned.slice(dot);
      return cleaned.slice(0, 120 - ext.length) + ext;
    }
    return cleaned.slice(0, 120);
  }
  return cleaned;
}

/**
 * 把 topPriorityActions 里的「在 X 秒切镜」抽出来作为时间轴 cut points。
 * 同时把 push_in / pull_out 动作识别出来用于 keyframe。
 */
/**
 * 计算输出视频的 segment 计划：
 *   1) 从 LLM match 里抽出"必删片段"
 *   2) 从源视频里减去删除区间 → 剩余 keep ranges
 *   3) 在 keep ranges 内按用户素材/LLM 推荐的切点切成多段
 *   4) 每段在输出时间轴上紧贴拼接（target_timerange 从 0 累计递增）
 *
 * 返回的 plan 直接对应 CapCut segments。
 */
function buildEditPlan(
  match: TechniqueMatchingResult,
  potential: MaterialPotential,
  totalDurSec: number,
): EditSegmentPlan[] {
  // a) trim → keep
  const trims = extractTrimRanges(match, totalDurSec);
  const keepRanges = computeKeepRanges(totalDurSec, trims);

  // b) 切点：用户原视频自带的 cut + match 给的切点（仅那些在 keep range 内的会用上）
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

  // c) plan
  return planEditSegments(keepRanges, cutPoints, (sStart, sEnd, idx) =>
    pickAnimation(sStart, sEnd, idx, potential, match),
  );
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
  const projectId = id();
  const durationUs = secToMicroseconds(input.meta.durationSec);
  const isPortrait = input.meta.height > input.meta.width;
  const ratio =
    isPortrait && Math.abs(input.meta.width / input.meta.height - 9 / 16) < 0.05
      ? "9:16"
      : !isPortrait &&
          Math.abs(input.meta.width / input.meta.height - 16 / 9) < 0.05
        ? "16:9"
        : "original";

  // ===== Materials =====

  // path 用占位 token：server 端写不出用户机器的绝对路径，所以写
  // `${TOKEN_PROJECT_DIR}/materials/<file>`，zip 附的 setup 脚本在用户机器上
  // 把 token 字面替换成项目文件夹的绝对路径。CapCut 要的就是绝对路径
  // （原生项目 0203/0205 验证）。
  const videoMaterial: VideoMaterial = {
    id: id(),
    type: "video",
    path: `${TOKEN_PROJECT_DIR}/materials/${input.videoFileName}`,
    material_name: input.videoFileName,
    width: input.meta.width,
    height: input.meta.height,
    duration: durationUs,
    has_audio: input.meta.hasAudio,
  };

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
          Math.min(input.bgmDurationSec ?? input.meta.durationSec, input.meta.durationSec),
        ),
      }
    : null;

  // ===== Edit plan: trim + keep + segment placement =====
  // 把 LLM 的"必删片段"翻译成 source/target timerange 严格分离的 segments。
  // source_timerange 是从原视频取片，target_timerange 是输出时间轴上紧贴的位置。
  // 详见 lib/capcut-compiler/edit-plan.ts。

  const editPlan = buildEditPlan(
    input.match,
    input.potential,
    input.meta.durationSec,
  );

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

    // CapCut 要求 4 个 property type 一起设，否则整个动画被忽略
    // ScaleX 用多 keyframe 模拟 ease-in-out（CapCut keyframe schema 不暴露 easing 字段）
    const scaleFrom =
      p.animation.type === "none" ? 1.0 : p.animation.scaleFrom;
    const scaleTo = p.animation.type === "none" ? 1.0 : p.animation.scaleTo;
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
      material_id: videoMaterial.id,
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
      secToMicroseconds(input.bgmDurationSec ?? input.meta.durationSec),
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

  const subtitles = extractSubtitles(input.potential);
  const textMaterials: TextMaterial[] = [];

  // 字幕段的 target_timerange 必须重映射到剪辑后的输出时间轴：
  //   - 字幕落在被删除的 trim 区间 → 整条丢弃
  //   - 字幕跨过 trim 区间边界 → 截断到 keep 内的部分（简化：直接丢弃跨界的）
  const mapSourceToTarget = (srcSec: number): number | null => {
    for (const p of editPlan) {
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
    if (targetStartSec === null || targetEndSec === null) continue; // 字幕在被删的段里
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
    fps: Math.round(input.meta.fps),
    canvas_config: {
      width: input.meta.width,
      height: input.meta.height,
      ratio,
    },
    tracks,
    materials: {
      videos: [videoMaterial],
      audios: bgmMaterial ? [bgmMaterial] : [],
      texts: textMaterials,
      speeds,
      canvases,
      sound_channel_mappings: soundMappings,
      placeholder_infos: placeholders,
      vocal_separations: vocalSeparations,
      material_animations: [],
      audio_fades: [],
      transitions: [],
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

  const videoMetaEntry: DraftMaterialEntry = {
    ai_group_type: "",
    create_time: nowSec,
    duration: durationUs,
    extra_info: input.videoFileName,
    file_Path: `${TOKEN_PROJECT_DIR}/materials/${input.videoFileName}`,
    height: input.meta.height,
    id: videoMaterial.id,
    import_time: nowSec,
    import_time_ms: nowUs,
    item_source: 1,
    md5: "",
    metetype: "video",
    roughcut_time_range: { duration: durationUs, start: 0 },
    sub_time_range: { duration: -1, start: -1 },
    type: 0,
    width: input.meta.width,
  };

  const group0Entries: DraftMaterialEntry[] = [videoMetaEntry];

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
