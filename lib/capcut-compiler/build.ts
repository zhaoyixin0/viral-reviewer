import { randomUUID } from "crypto";
import { secToMicroseconds } from "@/lib/cut-plan/time-code";
import type { MaterialPotential } from "@/lib/cut-plan/material-potential";
import type { TechniqueMatchingResult } from "@/lib/technique-matching/types";
import type { VideoMeta } from "@/lib/video/ffprobe-meta";
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
 * 把 topPriorityActions 里的「在 X 秒切镜」抽出来作为时间轴 cut points。
 * 同时把 push_in / pull_out 动作识别出来用于 keyframe。
 */
function extractCutPointsAndAnimations(
  match: TechniqueMatchingResult,
  potential: MaterialPotential,
  durationSec: number,
) {
  // 候选切点 = topPriorityActions 里带 userVideoAt 的 + 用户已有 actions 中的 cut
  const cutSet = new Set<number>([0]); // 永远从 0 开始

  for (const a of match.topPriorityActions) {
    if (a.userVideoAt && typeof a.userVideoAt.sec === "number") {
      cutSet.add(a.userVideoAt.sec);
    }
  }
  // 用户原视频本身的切点也作为基础（避免 LLM 漏掉的）
  for (const action of potential.base.actions) {
    if (action.kind === "cut" && typeof action.at.sec === "number") {
      cutSet.add(action.at.sec);
    }
  }

  const sorted = Array.from(cutSet)
    .filter((t) => t >= 0 && t < durationSec - 0.2) // 离结尾太近不切
    .sort((a, b) => a - b);

  // 转成 [start, end] 区间
  const cutRanges: { startSec: number; endSec: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const startSec = sorted[i];
    const endSec = i + 1 < sorted.length ? sorted[i + 1] : durationSec;
    cutRanges.push({ startSec, endSec });
  }

  // 每段都给一个可见的缩放动画，让画面有"呼吸感"，跟原片连续画面形成视觉差异
  // 优先级：用户素材里识别到的 camera_move > match 推荐 > 兜底默认 push_in
  const animationByRange = cutRanges.map((range, idx) => {
    type Anim = {
      type: "push_in" | "pull_out";
      scaleFrom: number;
      scaleTo: number;
    };

    // 1) 用户原视频在该范围内的 camera_move
    for (const action of potential.base.actions) {
      if (action.kind !== "camera_move") continue;
      const at = action.at.sec;
      if (at >= range.startSec && at < range.endSec) {
        if (action.type === "push_in") {
          return {
            type: "push_in" as const,
            scaleFrom: action.scaleFrom ?? 1.0,
            scaleTo: action.scaleTo ?? 1.15,
          };
        }
        if (action.type === "pull_out") {
          return {
            type: "pull_out" as const,
            scaleFrom: action.scaleFrom ?? 1.1,
            scaleTo: action.scaleTo ?? 0.95,
          };
        }
      }
    }

    // 2) match 推荐在该范围内
    for (const report of match.reports) {
      for (const rec of report.recommendations) {
        if (rec.verdict !== "learn" && rec.verdict !== "adapt") continue;
        if (!rec.userVideoAt) continue;
        const t = rec.userVideoAt.sec;
        if (t < range.startSec || t >= range.endSec) continue;
        const name = rec.technique.name.toLowerCase();
        if (name.includes("push") || name.includes("punch") || name.includes("推近") || name.includes("zoom in")) {
          return { type: "push_in" as const, scaleFrom: 1.0, scaleTo: 1.15 };
        }
        if (name.includes("pull") || name.includes("拉远") || name.includes("zoom out")) {
          return { type: "pull_out" as const, scaleFrom: 1.1, scaleTo: 1.0 };
        }
      }
    }

    // 3) 兜底：交替 push_in / pull_out 让每段都有可见运动差异
    return idx % 2 === 0
      ? { type: "push_in" as const, scaleFrom: 1.0, scaleTo: 1.12 }
      : { type: "pull_out" as const, scaleFrom: 1.08, scaleTo: 1.0 };
  });

  return { cutRanges, animationByRange };
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

  const videoMaterial: VideoMaterial = {
    id: id(),
    type: "video",
    path: `##_draftpath_placeholder_##/materials/${input.videoFileName}`,
    material_name: input.videoFileName,
    width: input.meta.width,
    height: input.meta.height,
    duration: durationUs,
    has_audio: input.meta.hasAudio,
  };

  // 视频自带音轨已经在 video segment 里播放（speed=1, volume=1）。
  // 只有用户主动上传 BGM 时才创建独立 audio 轨（Phase 5.5）。
  //
  // path 说明：CapCut "链接媒体" 弹窗只匹配 video，audio 类型不进列表。
  // 所以 audio path 不能用 placeholder（用户没办法手动 fix）。
  // 尝试用纯相对路径 "materials/bgm.mp3" — CapCut 桌面端打开时如果识别相对路径
  // 会相对项目根目录 resolve（项目根 = com.lveditor.draft\<projectName>\）。
  const bgmMaterial: AudioMaterial | null = input.bgmFileName
    ? {
        id: id(),
        type: "music",
        path: `materials/${input.bgmFileName}`,
        name: input.bgmFileName,
        duration: secToMicroseconds(
          Math.min(input.bgmDurationSec ?? input.meta.durationSec, input.meta.durationSec),
        ),
      }
    : null;

  // ===== Cut points + animations =====

  const { cutRanges, animationByRange } = extractCutPointsAndAnimations(
    input.match,
    input.potential,
    input.meta.durationSec,
  );

  // ===== Companion materials per video segment =====

  const speeds: SpeedMaterial[] = [];
  const canvases: CanvasMaterial[] = [];
  const soundMappings: SoundChannelMaterial[] = [];
  const placeholders: PlaceholderMaterial[] = [];
  const vocalSeparations: VocalSeparationMaterial[] = [];

  // ===== Video track segments =====

  const videoSegments: VideoSegment[] = cutRanges.map((range, idx) => {
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

    const startUs = secToMicroseconds(range.startSec);
    const endUs = secToMicroseconds(range.endSec);
    const segDurationUs = endUs - startUs;

    const a = animationByRange[idx];
    // CapCut 要求 4 个 property type 一起设，否则整个动画被忽略
    // ScaleX 驱动缩放，PositionX/Y/Rotation 给 0 占位
    const keyframes: CommonKeyframe[] = [
      {
        property_type: "KFTypeScaleX",
        keyframe_list: [
          { time_offset: 0, values: [a.scaleFrom] },
          { time_offset: segDurationUs, values: [a.scaleTo] },
        ],
      },
      {
        property_type: "KFTypePositionX",
        keyframe_list: [
          { time_offset: 0, values: [0] },
          { time_offset: segDurationUs, values: [0] },
        ],
      },
      {
        property_type: "KFTypePositionY",
        keyframe_list: [
          { time_offset: 0, values: [0] },
          { time_offset: segDurationUs, values: [0] },
        ],
      },
      {
        property_type: "KFTypeRotation",
        keyframe_list: [
          { time_offset: 0, values: [0] },
          { time_offset: segDurationUs, values: [0] },
        ],
      },
    ];

    return {
      id: id(),
      material_id: videoMaterial.id,
      target_timerange: { start: startUs, duration: segDurationUs },
      source_timerange: { start: startUs, duration: segDurationUs },
      speed: 1,
      volume: 1,
      visible: true,
      // clip.scale 必须跟 keyframe 起始值一致，否则 CapCut 不应用动画
      clip: {
        ...ZERO_CLIP,
        scale: { x: a.scaleFrom, y: a.scaleFrom },
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
    const bgmDur = Math.min(
      secToMicroseconds(input.bgmDurationSec ?? input.meta.durationSec),
      durationUs,
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
  const textSegments: TextSegment[] = subtitles.map((sub, idx) => {
    const textMat: TextMaterial = {
      id: id(),
      type: "text",
      // CapCut text material.content is plain text. Styling goes through other fields.
      content: sub.text,
      font_size: 22,
      color: "#FFFFFF",
      alignment: 1,
    };
    textMaterials.push(textMat);

    const startUs = secToMicroseconds(sub.atSec);
    const durUs = secToMicroseconds(sub.durationSec);

    return {
      id: id(),
      material_id: textMat.id,
      target_timerange: { start: startUs, duration: durUs },
      source_timerange: { start: 0, duration: durUs },
      visible: true,
      extra_material_refs: [],
      render_index: 1000 + idx, // 字幕在视频之上
    };
  });

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
    duration: durationUs,
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
    new_version: "36.0.0",
    last_modified_platform: {
      app_id: 359289,
      app_source: "lv",
      app_version: "5.7.0",
      device_id: "00000000-0000-0000-0000-000000000000",
      hard_disk_id: "00000000-0000-0000-0000-000000000000",
      mac_address: "00:00:00:00:00:00",
      os: "windows",
      os_version: "10.0",
    },
  };

  const metaInfo: DraftMetaInfo = {
    draft_id: projectId,
    draft_name: input.projectName,
    draft_root_path: "",
    draft_fold_path: "",
    draft_removable_storage_device: "",
    draft_timeline_materials_size_: 0,
    draft_materials: [],
    draft_materials_copied_info: [],
    tm_draft_create: nowMs(),
    tm_draft_modified: nowMs(),
    tm_duration: durationUs,
    draft_cover: "draft_cover.jpg",
    draft_deleted: false,
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_from_deeplink: "false",
    draft_is_invisible: false,
    draft_new_version: "36.0.0",
    draft_segment_extra_info: [],
    draft_type: "",
  };

  return { draftContent, metaInfo };
}
