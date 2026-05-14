/**
 * CapCut draft_content.json schema (逆向自社区 capcut-cli + 直接观察 CapCut 桌面项目)
 *
 * 时间单位：全部 μs（微秒）
 * 路径：material.path 必须是素材的绝对路径（原生项目 0203/0205 验证）。server 端
 *       写占位 token，zip 附的 setup 脚本在用户机器上替换成本机绝对路径。
 */

export type TimeRange = {
  start: number; // μs
  duration: number; // μs
};

// ===== Materials =====

export type VideoMaterial = {
  id: string; // UUID
  type: "video";
  path: string; // 绝对路径；server 写 token（见 setup-scripts/tokens.ts）
  material_name: string;
  width: number;
  height: number;
  duration: number; // μs
  has_audio: boolean;
};

export type AudioMaterial = {
  id: string;
  type: "extract_music" | "music";
  path: string;
  name: string;
  duration: number; // μs
};

export type TextMaterial = {
  id: string;
  type: "text";
  content: string; // CapCut 实际是 JSON-encoded text style，简化版用纯字符串
  font_size?: number;
  color?: string; // "#RRGGBB"
  alignment?: number; // 0=left, 1=center, 2=right
};

export type SpeedMaterial = {
  id: string;
  type: "speed";
  speed: number;
  mode: 0;
};

export type CanvasMaterial = {
  id: string;
  type: "canvas_color";
  color: "";
  image: "";
};

export type SoundChannelMaterial = {
  id: string;
  type: "none";
  audio_channel_mapping: 0;
  is_config_open: false;
};

export type PlaceholderMaterial = {
  id: string;
  type: "placeholder_info";
  error_path: "";
  error_text: "";
  meta_type: "none";
};

export type VocalSeparationMaterial = {
  id: string;
  type: "vocal_separation";
  choice: 0;
  production_path: "";
  removed_sounds: never[];
  time_range: { duration: 0; start: 0 };
};

// ===== Segments =====

export type Keyframe = {
  /** 相对 segment 起点的微秒偏移 */
  time_offset: number;
  /** 单值 keyframe（scale_x 1 个值） */
  values: number[];
};

export type CommonKeyframe = {
  /**
   * 常见类型：
   *   KFTypeScaleX / KFTypeScaleY (push_in / pull_out 缩放)
   *   KFTypePositionX / KFTypePositionY (平移)
   *   KFTypeAlpha (淡入淡出)
   *   KFTypeRotation
   */
  property_type: string;
  keyframe_list: Keyframe[];
};

export type SegmentClip = {
  alpha: number;
  rotation: number;
  scale: { x: number; y: number };
  transform: { x: number; y: number };
  flip?: { horizontal: false; vertical: false };
};

export type VideoSegment = {
  id: string;
  material_id: string;
  target_timerange: TimeRange; // 在主时间轴的位置
  source_timerange: TimeRange; // 从视频源里截取的范围
  speed: number;
  volume: number;
  visible: boolean;
  clip?: SegmentClip;
  extra_material_refs: string[]; // 关联的 speed / canvas_color 等 material id
  render_index: number;
  common_keyframes?: CommonKeyframe[];
};

export type AudioSegment = {
  id: string;
  material_id: string;
  target_timerange: TimeRange;
  source_timerange: TimeRange;
  speed: number;
  volume: number;
  visible: boolean;
  extra_material_refs: string[];
  render_index: number;
};

export type TextSegment = {
  id: string;
  material_id: string;
  target_timerange: TimeRange;
  source_timerange: TimeRange;
  visible: boolean;
  extra_material_refs: string[];
  render_index: number;
};

// ===== Tracks =====

export type VideoTrack = {
  id: string;
  type: "video";
  attribute: 0;
  flag: 0;
  segments: VideoSegment[];
  is_default_name: boolean;
  name?: string;
};

export type AudioTrack = {
  id: string;
  type: "audio";
  attribute: 0;
  flag: 0;
  segments: AudioSegment[];
  is_default_name: boolean;
  name?: string;
};

export type TextTrack = {
  id: string;
  type: "text";
  attribute: 0;
  flag: 0;
  segments: TextSegment[];
  is_default_name: boolean;
  name?: string;
};

export type Track = VideoTrack | AudioTrack | TextTrack;

// ===== Root =====

export type DraftContent = {
  id: string;
  name: string;
  duration: number; // μs，整个项目时长
  fps: number;
  canvas_config: {
    width: number;
    height: number;
    ratio: string; // "9:16" / "16:9" / "original"
  };
  tracks: Track[];
  materials: {
    videos: VideoMaterial[];
    audios: AudioMaterial[];
    texts: TextMaterial[];
    speeds: SpeedMaterial[];
    canvases: CanvasMaterial[];
    sound_channel_mappings: SoundChannelMaterial[];
    placeholder_infos: PlaceholderMaterial[];
    vocal_separations: VocalSeparationMaterial[];
    /** Phase 5+ 字段：material_animations / audio_fades / transitions / video_effects */
    material_animations: unknown[];
    audio_fades: unknown[];
    transitions: unknown[];
    video_effects: unknown[];
  };
  /** 创建时间戳，CapCut 用 100-nanosecond ticks 自 1601-01-01 */
  create_time: number;
  update_time: number;
  /** 版本相关（CapCut 桌面端会读但兼容多版本） */
  version: number;
  new_version: string;
  last_modified_platform: {
    app_id: number;
    /** "lv" = 剪映国内版，"cc" = CapCut 国际版 */
    app_source: "lv" | "cc";
    app_version: string;
    device_id: string;
    hard_disk_id: string;
    mac_address: string;
    os: "windows" | "mac";
    os_version: string;
  };
};

// ===== Meta (draft_meta_info.json) =====

/**
 * draft_meta_info 设计 — Setup-Script 方案（2026-05-13）：
 *
 * CapCut 用「指向素材原始位置的绝对路径」引用素材，存在 draft_content.json 的
 * materials.*.path 和 draft_meta_info.json 的 draft_materials[].value[].file_Path
 * （本机原生项目 0203 / 0205 + capcut-cli 源码三方验证）。
 *
 * 历史教训纠正：commit 5db8fce 试图填 draft_materials 让 CapCut 自动定位媒体，
 * 失败的真正原因是它填的 file_Path 是相对路径 "./materials/input.mp4" —— 不是
 * "填 draft_materials" 这个动作错。原生 0203 证明：填**绝对** file_Path 正是
 * CapCut 能用的状态。
 *
 * 本方案：server 端把 file_Path / draft_fold_path / draft_root_path / videos[].path
 * 全写成占位 token（见 setup-scripts/tokens.ts），zip 附 setup 脚本，用户解压后
 * 运行脚本在本机把 token 字面替换成绝对路径。draft_materials 复刻原生 0203 的
 * 七组结构（type 0/1/2/3/6/7/8），type 0 组放视频（和 BGM）条目。
 */

/** draft_materials[].value[] 单条素材记录，对齐原生 0203 项目结构 */
export type DraftMaterialEntry = {
  ai_group_type: "";
  create_time: number;
  duration: number; // μs
  extra_info: string; // 文件名，如 "20260429-200100.mp4"
  /** 素材绝对路径；server 写 token，setup 脚本替换 */
  file_Path: string;
  height: number;
  /** 必须等于 draft_content.json 里对应 material 的 id */
  id: string;
  import_time: number;
  import_time_ms: number;
  item_source: 1;
  md5: "";
  metetype: "video" | "music";
  roughcut_time_range: { duration: number; start: number };
  sub_time_range: { duration: number; start: number };
  type: number;
  width: number;
};

export type DraftMaterialGroup = {
  /** 0=本地导入媒体（视频/音频），1/2/3/6/7/8=其它分类，本方案只往 type 0 填 */
  type: number;
  value: DraftMaterialEntry[];
};

export type DraftMetaInfo = {
  draft_id: string; // 同 DraftContent.id
  draft_name: string;
  /** drafts 目录绝对路径（com.lveditor.draft）；server 写 token */
  draft_root_path: string;
  /** 项目文件夹绝对路径；server 写 token */
  draft_fold_path: string;
  draft_removable_storage_device: "";
  draft_timeline_materials_size_: number;
  draft_materials: DraftMaterialGroup[];
  draft_materials_copied_info: never[];
  tm_draft_create: number;
  tm_draft_modified: number;
  tm_duration: number;
  draft_cover: "draft_cover.jpg";
  draft_deleted: false;
  draft_is_ai_packaging_used: false;
  draft_is_ai_shorts: false;
  draft_is_ai_translate: false;
  draft_is_article_video_draft: false;
  draft_is_from_deeplink: "false";
  draft_is_invisible: false;
  draft_new_version: string;
  draft_segment_extra_info: never[];
  draft_type: "";
};
